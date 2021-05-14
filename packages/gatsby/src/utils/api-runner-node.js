const Promise = require(`bluebird`)
const _ = require(`lodash`)
const chalk = require(`chalk`)
const { bindActionCreators: origBindActionCreators } = require(`redux`)
const memoize = require(`memoizee`)

const bindActionCreators = memoize(origBindActionCreators)

const tracer = require(`opentracing`).globalTracer()
const reporter = require(`gatsby-cli/lib/reporter`)
const stackTrace = require(`stack-trace`)
const { codeFrameColumns } = require(`@babel/code-frame`)
const fs = require(`fs-extra`)
const { getCache } = require(`./get-cache`)
import { createNodeId } from "./create-node-id"
const { createContentDigest } = require(`gatsby-core-utils`)
import {
  buildObjectType,
  buildUnionType,
  buildInterfaceType,
  buildInputObjectType,
  buildEnumType,
  buildScalarType,
} from "../schema/types/type-builders"
const { emitter, store } = require(`../redux`)
const {
  getNodes,
  getNode,
  getNodesByType,
  getNodeAndSavePathDependency,
} = require(`../redux/nodes`)
const { getPublicPath } = require(`./get-public-path`)
const { getNonGatsbyCodeFrameFormatted } = require(`./stack-trace-utils`)
const { trackBuildError, decorateEvent } = require(`gatsby-telemetry`)
import errorParser from "./api-runner-error-parser"
const { loadNodeContent } = require(`../db/nodes`)

if (!process.env.BLUEBIRD_DEBUG && !process.env.BLUEBIRD_LONG_STACK_TRACES) {
  // Unless specified - disable longStackTraces
  // as this have severe perf penalty ( http://bluebirdjs.com/docs/api/promise.longstacktraces.html )
  // This is mainly for `gatsby develop` due to NODE_ENV being set to development
  // which cause bluebird to enable longStackTraces
  // `gatsby build` (with NODE_ENV=production) already doesn't enable longStackTraces
  Promise.config({ longStackTraces: false })
}

// Bind action creators per plugin so we can auto-add
// metadata to actions they create.
const boundPluginActionCreators = {}
const doubleBind = (boundActionCreators, api, plugin, actionOptions) => {
  const { traceId, deferNodeMutation } = actionOptions
  const defer = deferNodeMutation ? `defer-node-mutation` : ``
  const actionKey = plugin.name + api + traceId + defer
  if (boundPluginActionCreators[actionKey]) {
    return boundPluginActionCreators[actionKey]
  } else {
    const keys = Object.keys(boundActionCreators)
    const doubleBoundActionCreators = {}
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const boundActionCreator = boundActionCreators[key]
      if (typeof boundActionCreator === `function`) {
        doubleBoundActionCreators[key] = (...args) => {
          // Let action callers override who the plugin is. Shouldn't be
          // used that often.
          if (args.length === 1) {
            return boundActionCreator(args[0], plugin, actionOptions)
          } else if (args.length === 2) {
            return boundActionCreator(args[0], args[1], actionOptions)
          }
          return undefined
        }
      }
    }
    boundPluginActionCreators[actionKey] = doubleBoundActionCreators
    return doubleBoundActionCreators
  }
}

const initAPICallTracing = parentSpan => {
  const startSpan = (spanName, spanArgs = {}) => {
    const defaultSpanArgs = { childOf: parentSpan }

    return tracer.startSpan(spanName, _.merge(defaultSpanArgs, spanArgs))
  }

  return {
    tracer,
    parentSpan,
    startSpan,
  }
}

const deferredAction = type => (...args) => {
  // Regular createNode returns a Promise, but when deferred we need
  // to wrap it in another which we resolve when it's actually called
  if (type === `createNode`) {
    return new Promise(resolve => {
      emitter.emit(`ENQUEUE_NODE_MUTATION`, {
        type,
        payload: args,
        resolve,
      })
    })
  }
  return emitter.emit(`ENQUEUE_NODE_MUTATION`, {
    type,
    payload: args,
  })
}

const NODE_MUTATION_ACTIONS = [
  `createNode`,
  `deleteNode`,
  `touchNode`,
  `createParentChildLink`,
  `createNodeField`,
]

const deferActions = actions => {
  const deferred = { ...actions }
  NODE_MUTATION_ACTIONS.forEach(action => {
    deferred[action] = deferredAction(action)
  })
  return deferred
}

/**
 * Create a local reporter
 * Used to override reporter methods with activity methods
 */
function getLocalReporter({ activity, reporter }) {
  // If we have an activity, bind panicOnBuild to the activities method to
  // join them
  if (activity) {
    return { ...reporter, panicOnBuild: activity.panicOnBuild.bind(activity) }
  }

  return reporter
}

function getErrorMapWithPluginName(pluginName, errorMap) {
  const entries = Object.entries(errorMap)

  return entries.reduce((memo, [key, val]) => {
    memo[`${pluginName}_${key}`] = val

    return memo
  }, {})
}

function extendLocalReporterToCatchPluginErrors({
  reporter,
  pluginName,
  runningActivities,
}) {
  let setErrorMap

  let error = reporter.error
  let panic = reporter.panic
  let panicOnBuild = reporter.panicOnBuild

  if (pluginName && reporter?.setErrorMap) {
    setErrorMap = errorMap =>
      reporter.setErrorMap(getErrorMapWithPluginName(pluginName, errorMap))

    error = (errorMeta, error) => {
      reporter.error(errorMeta, error, pluginName)
    }

    panic = (errorMeta, error) => {
      reporter.panic(errorMeta, error, pluginName)
    }

    panicOnBuild = (errorMeta, error) => {
      reporter.panicOnBuild(errorMeta, error, pluginName)
    }
  }

  return {
    ...reporter,
    setErrorMap,
    error,
    panic,
    panicOnBuild,
    activityTimer: (...args) => {
      // eslint-disable-next-line prefer-spread
      const activity = reporter.activityTimer.apply(reporter, args)

      const originalStart = activity.start
      const originalEnd = activity.end

      activity.start = () => {
        originalStart.apply(activity)
        runningActivities.add(activity)
      }

      activity.end = () => {
        originalEnd.apply(activity)
        runningActivities.delete(activity)
      }

      return activity
    },

    createProgress: (...args) => {
      // eslint-disable-next-line prefer-spread
      const activity = reporter.createProgress.apply(reporter, args)

      const originalStart = activity.start
      const originalEnd = activity.end
      const originalDone = activity.done

      activity.start = () => {
        originalStart.apply(activity)
        runningActivities.add(activity)
      }

      activity.end = () => {
        originalEnd.apply(activity)
        runningActivities.delete(activity)
      }

      activity.done = () => {
        originalDone.apply(activity)
        runningActivities.delete(activity)
      }

      return activity
    },
  }
}

const getUninitializedCache = plugin => {
  const message =
    `Usage of "cache" instance in "onPreInit" API is not supported as ` +
    `this API runs before cache initialization` +
    (plugin && plugin !== `default-site-plugin` ? ` (called in ${plugin})` : ``)

  return {
    // GatsbyCache
    async get() {
      throw new Error(message)
    },
    async set() {
      throw new Error(message)
    },
  }
}

const pluginNodeCache = new Map()

const availableActionsCache = new Map()
let publicPath
const runAPI = async (plugin, api, args, activity) => {
  let gatsbyNode = pluginNodeCache.get(plugin.name)
  if (!gatsbyNode) {
    gatsbyNode = require(`${plugin.resolve}/gatsby-node`)
    pluginNodeCache.set(plugin.name, gatsbyNode)
  }

  if (gatsbyNode[api]) {
    const parentSpan = args && args.parentSpan
    const spanOptions = parentSpan ? { childOf: parentSpan } : {}
    const pluginSpan = tracer.startSpan(`run-plugin`, spanOptions)

    pluginSpan.setTag(`api`, api)
    pluginSpan.setTag(`plugin`, plugin.name)
    const {
      publicActions,
      restrictedActionsAvailableInAPI,
    } = require(`../redux/actions`)

    let availableActions
    if (availableActionsCache.has(api)) {
      availableActions = availableActionsCache.get(api)
    } else {
      availableActions = {
        ...publicActions,
        ...(restrictedActionsAvailableInAPI[api] || {}),
      }

      if (process.env.JEST_WORKER_ID) {
        // allow using `createTypes` action in workers, log everything else
        availableActions = Object.fromEntries(
          Object.entries(availableActions).map(
            ([actionName, actionCreator]) => [
              actionName,
              actionName === `createTypes`
                ? actionCreator
                : (...args) => {
                    console.log(
                      `action from worker`,
                      process.env.JEST_WORKER_ID,
                      actionName,
                      args
                    )
                    return () => Promise.resolve()
                  },
            ]
          )
        )
      }

      availableActionsCache.set(api, availableActions)
    }

    let boundActionCreators = bindActionCreators(
      availableActions,
      store.dispatch
    )

    if (args.deferNodeMutation) {
      boundActionCreators = deferActions(boundActionCreators)
    }

    const doubleBoundActionCreators = doubleBind(
      boundActionCreators,
      api,
      plugin,
      { ...args, parentSpan: pluginSpan, activity }
    )

    const { config, program } = store.getState()

    const pathPrefix = (program.prefixPaths && config.pathPrefix) || ``

    if (typeof publicPath === `undefined`) {
      publicPath = getPublicPath({ ...config, ...program }, ``)
    }

    const namespacedCreateNodeId = id => createNodeId(id, plugin.name)

    const tracing = initAPICallTracing(pluginSpan)

    // See https://github.com/gatsbyjs/gatsby/issues/11369
    const cache =
      api === `onPreInit`
        ? getUninitializedCache(plugin.name)
        : getCache(plugin.name)

    // Ideally this would be more abstracted and applied to more situations, but right now
    // this can be potentially breaking so targeting `createPages` API and `createPage` action
    let actions = doubleBoundActionCreators
    let apiFinished = false
    if (api === `createPages`) {
      let alreadyDisplayed = false
      const createPageAction = actions.createPage
      // create new actions object with wrapped createPage action
      // doubleBoundActionCreators is memoized, so we can't just
      // reassign createPage field as this would cause this extra logic
      // to be used in subsequent APIs and we only want to target this `createPages` call.
      actions = {
        ...actions,
        createPage: (...args) => {
          createPageAction(...args)
          if (apiFinished && !alreadyDisplayed) {
            const warning = [
              reporter.stripIndent(`
              Action ${chalk.bold(
                `createPage`
              )} was called outside of its expected asynchronous lifecycle ${chalk.bold(
                `createPages`
              )} in ${chalk.bold(plugin.name)}.
              Ensure that you return a Promise from ${chalk.bold(
                `createPages`
              )} and are awaiting any asynchronous method invocations (like ${chalk.bold(
                `graphql`
              )} or http requests).
              For more info and debugging tips: see ${chalk.bold(
                `https://gatsby.dev/sync-actions`
              )}
            `),
            ]

            const possiblyCodeFrame = getNonGatsbyCodeFrameFormatted()
            if (possiblyCodeFrame) {
              warning.push(possiblyCodeFrame)
            }

            reporter.warn(warning.join(`\n\n`))
            alreadyDisplayed = true
          }
        },
      }
    }

    const localReporter = getLocalReporter({ activity, reporter })

    const runningActivities = new Set()

    const extendedLocalReporter = extendLocalReporterToCatchPluginErrors({
      reporter: localReporter,
      pluginName: plugin.name,
      runningActivities,
    })

    const endInProgressActivitiesCreatedByThisRun = () => {
      runningActivities.forEach(activity => activity.end())
    }

    const apiCallArgs = [
      {
        ...args,
        basePath: pathPrefix,
        pathPrefix: publicPath,
        actions,
        loadNodeContent,
        store,
        emitter,
        getCache,
        getNodes,
        getNode,
        getNodesByType,
        reporter: extendedLocalReporter,
        getNodeAndSavePathDependency,
        cache,
        createNodeId: namespacedCreateNodeId,
        createContentDigest,
        tracing,
        schema: {
          buildObjectType,
          buildUnionType,
          buildInterfaceType,
          buildInputObjectType,
          buildEnumType,
          buildScalarType,
        },
      },
      plugin.pluginOptions,
    ]

    // If the plugin is using a callback use that otherwise
    // expect a Promise to be returned.
    if (gatsbyNode[api].length === 3) {
      return Promise.fromCallback(callback => {
        const cb = (err, val) => {
          pluginSpan.finish()
          apiFinished = true
          endInProgressActivitiesCreatedByThisRun()
          callback(err, val)
        }

        try {
          gatsbyNode[api](...apiCallArgs, cb)
        } catch (e) {
          trackBuildError(api, {
            error: e,
            pluginName: `${plugin.name}@${plugin.version}`,
          })
          throw e
        }
      })
    } else {
      try {
        return await gatsbyNode[api](...apiCallArgs)
      } finally {
        pluginSpan.finish()
        apiFinished = true
        endInProgressActivitiesCreatedByThisRun()
      }
    }
  }

  return null
}

const apisRunningById = new Map()
const apisRunningByTraceId = new Map()
let waitingForCasacadeToFinish = []

module.exports = (api, args = {}, { pluginSource, activity } = {}) => {
  const plugins = store.getState().flattenedPlugins

  // Get the list of plugins that implement this API.
  // Also: Break infinite loops. Sometimes a plugin will implement an API and
  // call an action which will trigger the same API being called.
  // `onCreatePage` is the only example right now. In these cases, we should
  // avoid calling the originating plugin again.
  let implementingPlugins = plugins.filter(
    plugin => plugin.nodeAPIs.includes(api) && plugin.name !== pluginSource
  )

  if (api === `sourceNodes` && args.pluginName) {
    implementingPlugins = implementingPlugins.filter(
      plugin => plugin.name === args.pluginName
    )
  }

  // If there's no implementing plugins, return early.
  if (implementingPlugins.length === 0) {
    return null
  }

  return new Promise(resolve => {
    const { parentSpan, traceId, traceTags, waitForCascadingActions } = args
    const apiSpanArgs = parentSpan ? { childOf: parentSpan } : {}
    const apiSpan = tracer.startSpan(`run-api`, apiSpanArgs)

    apiSpan.setTag(`api`, api)
    _.forEach(traceTags, (value, key) => {
      apiSpan.setTag(key, value)
    })

    const apiRunInstance = {
      api,
      args,
      pluginSource,
      resolve,
      span: apiSpan,
      startTime: new Date().toJSON(),
      traceId,
    }

    // Generate IDs for api runs. Most IDs we generate from the args
    // but some API calls can have very large argument objects so we
    // have special ways of generating IDs for those to avoid stringifying
    // large objects.
    let id
    if (api === `setFieldsOnGraphQLNodeType`) {
      id = `${api}${apiRunInstance.startTime}${args.type.name}${traceId}`
    } else if (api === `onCreateNode`) {
      id = `${api}${apiRunInstance.startTime}${args.node.internal.contentDigest}${traceId}`
    } else if (api === `preprocessSource`) {
      id = `${api}${apiRunInstance.startTime}${args.filename}${traceId}`
    } else if (api === `onCreatePage`) {
      id = `${api}${apiRunInstance.startTime}${args.page.path}${traceId}`
    } else {
      // When tracing is turned on, the `args` object will have a
      // `parentSpan` field that can be quite large. So we omit it
      // before calling stringify
      const argsJson = JSON.stringify(_.omit(args, `parentSpan`))
      id = `${api}|${apiRunInstance.startTime}|${apiRunInstance.traceId}|${argsJson}`
    }
    apiRunInstance.id = id

    if (waitForCascadingActions) {
      waitingForCasacadeToFinish.push(apiRunInstance)
    }

    if (apisRunningById.size === 0) {
      emitter.emit(`API_RUNNING_START`)
    }

    apisRunningById.set(apiRunInstance.id, apiRunInstance)
    if (apisRunningByTraceId.has(apiRunInstance.traceId)) {
      const currentCount = apisRunningByTraceId.get(apiRunInstance.traceId)
      apisRunningByTraceId.set(apiRunInstance.traceId, currentCount + 1)
    } else {
      apisRunningByTraceId.set(apiRunInstance.traceId, 1)
    }

    let stopQueuedApiRuns = false
    let onAPIRunComplete = null
    if (api === `onCreatePage`) {
      const path = args.page.path
      const actionHandler = action => {
        if (action.payload.path === path) {
          stopQueuedApiRuns = true
        }
      }
      emitter.on(`DELETE_PAGE`, actionHandler)
      onAPIRunComplete = () => {
        emitter.off(`DELETE_PAGE`, actionHandler)
      }
    }

    let apiRunPromiseOptions = {}
    let runPromise
    if (
      api === `sourceNodes` &&
      process.env.GATSBY_EXPERIMENTAL_PARALLEL_SOURCING
    ) {
      runPromise = Promise.map
      apiRunPromiseOptions.concurrency = 20
    } else {
      runPromise = Promise.mapSeries
      apiRunPromiseOptions = undefined
    }

    runPromise(
      implementingPlugins,
      plugin => {
        if (stopQueuedApiRuns) {
          return null
        }

        let gatsbyNode = pluginNodeCache.get(plugin.name)
        if (!gatsbyNode) {
          gatsbyNode = require(`${plugin.resolve}/gatsby-node`)
          pluginNodeCache.set(plugin.name, gatsbyNode)
        }

        const pluginName =
          plugin.name === `default-site-plugin` ? `gatsby-node.js` : plugin.name

        // TODO: rethink createNode API to handle this better
        if (
          api === `onCreateNode` &&
          gatsbyNode?.unstable_shouldOnCreateNode && // Don't bail if this api is not exported
          !gatsbyNode.unstable_shouldOnCreateNode(
            { node: args.node },
            plugin.pluginOptions
          )
        ) {
          // Do not try to schedule an async event for this node for this plugin
          return null
        }

        return new Promise(resolve => {
          resolve(
            runAPI(plugin, api, { ...args, parentSpan: apiSpan }, activity)
          )
        }).catch(err => {
          decorateEvent(`BUILD_PANIC`, {
            pluginName: `${plugin.name}@${plugin.version}`,
          })

          const localReporter = getLocalReporter({ activity, reporter })

          const file = stackTrace
            .parse(err)
            .find(file => /gatsby-node/.test(file.fileName))

          let codeFrame = ``
          const structuredError = errorParser({ err })

          if (file) {
            const { fileName, lineNumber: line, columnNumber: column } = file

            try {
              const code = fs.readFileSync(fileName, { encoding: `utf-8` })
              codeFrame = codeFrameColumns(
                code,
                {
                  start: {
                    line,
                    column,
                  },
                },
                {
                  highlightCode: true,
                }
              )
            } catch (_e) {
              // sometimes stack trace point to not existing file
              // particularly when file is transpiled and path actually changes
              // (like pointing to not existing `src` dir or original typescript file)
            }

            structuredError.location = {
              start: { line: line, column: column },
            }
            structuredError.filePath = fileName
          }

          structuredError.context = {
            ...structuredError.context,
            pluginName,
            api,
            codeFrame,
          }

          localReporter.panicOnBuild(structuredError)

          return null
        })
      },
      apiRunPromiseOptions
    ).then(results => {
      if (onAPIRunComplete) {
        onAPIRunComplete()
      }
      // Remove runner instance
      apisRunningById.delete(apiRunInstance.id)
      const currentCount = apisRunningByTraceId.get(apiRunInstance.traceId)
      apisRunningByTraceId.set(apiRunInstance.traceId, currentCount - 1)

      if (apisRunningById.size === 0) {
        emitter.emit(`API_RUNNING_QUEUE_EMPTY`)
      }

      // Filter empty results
      apiRunInstance.results = results.filter(result => !_.isEmpty(result))

      // Filter out empty responses and return if the
      // api caller isn't waiting for cascading actions to finish.
      if (!waitForCascadingActions) {
        apiSpan.finish()
        resolve(apiRunInstance.results)
      }

      // Check if any of our waiters are done.
      waitingForCasacadeToFinish = waitingForCasacadeToFinish.filter(
        instance => {
          // If none of its trace IDs are running, it's done.
          const apisByTraceIdCount = apisRunningByTraceId.get(instance.traceId)
          if (apisByTraceIdCount === 0) {
            instance.span.finish()
            instance.resolve(instance.results)
            return false
          } else {
            return true
          }
        }
      )
      return
    })
  })
}
