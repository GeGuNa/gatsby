require(`v8-compile-cache`)

const crypto = require(`crypto`)
const fs = require(`fs-extra`)
const path = require(`path`)
const dotenv = require(`dotenv`)
const PnpWebpackPlugin = require(`pnp-webpack-plugin`)
const { store } = require(`../redux`)
const { actions } = require(`../redux/actions`)
const { getPublicPath } = require(`./get-public-path`)
const debug = require(`debug`)(`gatsby:webpack-config`)
const report = require(`gatsby-cli/lib/reporter`)
import { withBasePath, withTrailingSlash } from "./path"
import { getGatsbyDependents } from "./gatsby-dependents"

const apiRunnerNode = require(`./api-runner-node`)
import { createWebpackUtils } from "./webpack-utils"
import { hasLocalEslint } from "./local-eslint-config-finder"

const FRAMEWORK_BUNDLES = [`react`, `react-dom`, `scheduler`, `prop-types`]

// Four stages or modes:
//   1) develop: for `gatsby develop` command, hot reload and CSS injection into page
//   2) develop-html: same as develop without react-hmre in the babel config for html renderer
//   3) build-javascript: Build JS and CSS chunks for production
//   4) build-html: build all HTML files

module.exports = async (
  program,
  directory,
  suppliedStage,
  port,
  { parentSpan } = {}
) => {
  const modulesThatUseGatsby = await getGatsbyDependents()
  const directoryPath = withBasePath(directory)

  process.env.GATSBY_BUILD_STAGE = suppliedStage

  // We combine develop & develop-html stages for purposes of generating the
  // webpack config.
  const stage = suppliedStage
  const { rules, loaders, plugins } = createWebpackUtils(stage, program)

  const { assetPrefix, pathPrefix } = store.getState().config

  const publicPath = getPublicPath({ assetPrefix, pathPrefix, ...program })

  function processEnv(stage, defaultNodeEnv) {
    debug(`Building env for "${stage}"`)
    // node env should be DEVELOPMENT | PRODUCTION as these are commonly used in node land
    // this variable is used inside webpack
    const nodeEnv = process.env.NODE_ENV || `${defaultNodeEnv}`
    // config env is dependent on the env that it's run, this can be anything from staging-production
    // this allows you to set use different .env environments or conditions in gatsby files
    const configEnv = process.env.GATSBY_ACTIVE_ENV || nodeEnv
    const envFile = path.join(process.cwd(), `./.env.${configEnv}`)
    let parsed = {}
    try {
      parsed = dotenv.parse(fs.readFileSync(envFile, { encoding: `utf8` }))
    } catch (err) {
      if (err.code !== `ENOENT`) {
        report.error(
          `There was a problem processing the .env file (${envFile})`,
          err
        )
      }
    }

    const envObject = Object.keys(parsed).reduce((acc, key) => {
      acc[key] = JSON.stringify(parsed[key])
      return acc
    }, {})

    const gatsbyVarObject = Object.keys(process.env).reduce((acc, key) => {
      if (key.match(/^GATSBY_/)) {
        acc[key] = JSON.stringify(process.env[key])
      }
      return acc
    }, {})

    // Don't allow overwriting of NODE_ENV, PUBLIC_DIR as to not break gatsby things
    envObject.NODE_ENV = JSON.stringify(nodeEnv)
    envObject.PUBLIC_DIR = JSON.stringify(`${process.cwd()}/public`)
    envObject.BUILD_STAGE = JSON.stringify(stage)
    envObject.CYPRESS_SUPPORT = JSON.stringify(process.env.CYPRESS_SUPPORT)

    const mergedEnvVars = Object.assign(envObject, gatsbyVarObject)

    return Object.keys(mergedEnvVars).reduce(
      (acc, key) => {
        acc[`process.env.${key}`] = mergedEnvVars[key]
        return acc
      },
      {
        "process.env": JSON.stringify({}),
      }
    )
  }

  function getHmrPath() {
    // ref: https://github.com/gatsbyjs/gatsby/issues/8348
    let hmrBasePath = `/`
    const hmrSuffix = `__webpack_hmr&reload=true&overlay=false`

    if (process.env.GATSBY_WEBPACK_PUBLICPATH) {
      const pubPath = process.env.GATSBY_WEBPACK_PUBLICPATH
      if (pubPath.substr(-1) === `/`) {
        hmrBasePath = pubPath
      } else {
        hmrBasePath = withTrailingSlash(pubPath)
      }
    }

    return hmrBasePath + hmrSuffix
  }

  debug(`Loading webpack config for stage "${stage}"`)
  function getOutput() {
    switch (stage) {
      case `develop`:
        return {
          path: directory,
          filename: `[name].js`,
          // Add /* filename */ comments to generated require()s in the output.
          pathinfo: true,
          // Point sourcemap entries to original disk location (format as URL on Windows)
          publicPath: process.env.GATSBY_WEBPACK_PUBLICPATH || `/`,
          devtoolModuleFilenameTemplate: info =>
            path.resolve(info.absoluteResourcePath).replace(/\\/g, `/`),
          // Avoid React cross-origin errors
          // See https://reactjs.org/docs/cross-origin-errors.html
          crossOriginLoading: `anonymous`,
        }
      case `build-html`:
      case `develop-html`:
        // A temp file required by static-site-generator-plugin. See plugins() below.
        // Deleted by build-html.js, since it's not needed for production.
        return {
          path: directoryPath(`public`),
          filename: `render-page.js`,
          libraryTarget: `umd`,
          library: `lib`,
          umdNamedDefine: true,
          globalObject: `this`,
          publicPath: withTrailingSlash(publicPath),
        }
      case `build-javascript`:
        return {
          filename: `[name]-[contenthash].js`,
          chunkFilename: `[name]-[contenthash].js`,
          path: directoryPath(`public`),
          publicPath: withTrailingSlash(publicPath),
        }
      default:
        throw new Error(`The state requested ${stage} doesn't exist.`)
    }
  }

  function getEntry() {
    switch (stage) {
      case `develop`:
        return {
          commons: [
            require.resolve(`event-source-polyfill`),
            `${require.resolve(
              `webpack-hot-middleware/client`
            )}?path=${getHmrPath()}`,
            directoryPath(`.cache/app`),
          ],
        }
      case `develop-html`:
        return {
          main: directoryPath(`.cache/develop-static-entry`),
        }
      case `build-html`:
        return {
          main: directoryPath(`.cache/static-entry`),
        }
      case `build-javascript`:
        return {
          app: directoryPath(`.cache/production-app`),
        }
      default:
        throw new Error(`The state requested ${stage} doesn't exist.`)
    }
  }

  function getPlugins() {
    let configPlugins = [
      plugins.moment(),

      // Add a few global variables. Set NODE_ENV to production (enables
      // optimizations for React) and what the link prefix is (__PATH_PREFIX__).
      plugins.define({
        ...processEnv(stage, `development`),
        __BASE_PATH__: JSON.stringify(program.prefixPaths ? pathPrefix : ``),
        __PATH_PREFIX__: JSON.stringify(program.prefixPaths ? publicPath : ``),
        __ASSET_PREFIX__: JSON.stringify(
          program.prefixPaths ? assetPrefix : ``
        ),
      }),

      plugins.virtualModules(),
    ]

    switch (stage) {
      case `develop`:
        configPlugins = configPlugins
          .concat([
            process.env.GATSBY_HOT_LOADER === `fast-refresh` &&
              plugins.fastRefresh(),
            plugins.hotModuleReplacement(),
            plugins.noEmitOnErrors(),
            plugins.eslintGraphqlSchemaReload(),
          ])
          .filter(Boolean)
        break
      case `build-javascript`: {
        configPlugins = configPlugins.concat([
          plugins.extractText(),
          // Write out stats object mapping named dynamic imports (aka page
          // components) to all their async chunks.
          plugins.extractStats(),
        ])
        break
      }
    }

    return configPlugins
  }

  function getDevtool() {
    switch (stage) {
      case `develop`:
        return `cheap-module-source-map`
      // use a normal `source-map` for the html phases since
      // it gives better line and column numbers
      case `develop-html`:
      case `build-html`:
      case `build-javascript`:
        return `source-map`
      default:
        return false
    }
  }

  function getMode() {
    switch (stage) {
      case `build-javascript`:
        return `production`
      case `develop`:
      case `develop-html`:
      case `build-html`:
        return `development` // So we don't uglify the html bundle
      default:
        return `production`
    }
  }

  function getModule() {
    // Common config for every env.
    // prettier-ignore
    let configRules = [
      rules.js({
        modulesThatUseGatsby,
      }),
      rules.yaml(),
      rules.fonts(),
      rules.images(),
      rules.media(),
      rules.miscAssets(),

      // This is a hack that exports one of @reach/router internals (BaseContext)
      // to export list. We need it to reset basepath and baseuri context after
      // Gatsby main router changes it, to keep v2 behaviour.
      // We will need to most likely remove this for v3.
      {
        test: require.resolve(`@reach/router/es/index`),
        type: `javascript/auto`,
        use: [{
          loader: require.resolve(`./reach-router-add-basecontext-export-loader`),
        }],
      }
    ]

    // Speedup ??????????? the build! We only include transpilation of node_modules on javascript production builds
    // TODO create gatsby plugin to enable this behaviour on develop (only when people are requesting this feature)
    if (stage === `build-javascript`) {
      configRules.push(
        rules.dependencies({
          modulesThatUseGatsby,
        })
      )
    }

    if (store.getState().themes.themes) {
      configRules = configRules.concat(
        store.getState().themes.themes.map(theme => {
          return {
            test: /\.jsx?$/,
            include: theme.themeDir,
            use: [loaders.js()],
          }
        })
      )
    }

    switch (stage) {
      case `develop`: {
        // get schema to pass to eslint config and program for directory
        const { schema, program } = store.getState()

        // if no local eslint config, then add gatsby config
        if (!hasLocalEslint(program.directory)) {
          configRules = configRules.concat([rules.eslint(schema)])
        }

        configRules = configRules.concat([
          {
            oneOf: [rules.cssModules(), rules.css()],
          },
        ])

        // RHL will patch React, replace React-DOM by React-????-DOM and work with fiber directly
        // It's necessary to remove the warning in console (https://github.com/gatsbyjs/gatsby/issues/11934)
        // TODO: Remove entire block when we make fast-refresh the default
        if (process.env.GATSBY_HOT_LOADER !== `fast-refresh`) {
          configRules.push({
            include: /node_modules\/react-dom/,
            test: /\.jsx?$/,
            use: {
              loader: require.resolve(`./webpack-hmr-hooks-patch`),
            },
          })
        }

        break
      }
      case `build-html`:
      case `develop-html`:
        // We don't deal with CSS at all when building the HTML.
        // The 'null' loader is used to prevent 'module not found' errors.
        // On the other hand CSS modules loaders are necessary.

        // prettier-ignore
        configRules = configRules.concat([
          {
            oneOf: [
              rules.cssModules(),
              {
                ...rules.css(),
                use: [loaders.null()],
              },
            ],
          },
        ])
        break

      case `build-javascript`:
        // We don't deal with CSS at all when building JavaScript but we still
        // need to process the CSS so offline-plugin knows about the various
        // assets referenced in your CSS.
        //
        // It's also necessary to process CSS Modules so your JS knows the
        // classNames to use.
        configRules = configRules.concat([
          {
            oneOf: [rules.cssModules(), rules.css()],
          },
        ])

        break
    }

    return { rules: configRules }
  }

  function getResolve(stage) {
    const { program } = store.getState()
    const resolve = {
      // Use the program's extension list (generated via the
      // 'resolvableExtensions' API hook).
      extensions: [...program.extensions],
      alias: {
        gatsby$: directoryPath(path.join(`.cache`, `gatsby-browser-entry.js`)),
        // Using directories for module resolution is mandatory because
        // relative path imports are used sometimes
        // See https://stackoverflow.com/a/49455609/6420957 for more details
        "@babel/runtime": path.dirname(
          require.resolve(`@babel/runtime/package.json`)
        ),
        "core-js": path.dirname(require.resolve(`core-js/package.json`)),
        // TODO: Remove entire block when we make fast-refresh the default
        ...(process.env.GATSBY_HOT_LOADER !== `fast-refresh`
          ? {
              "react-hot-loader": path.dirname(
                require.resolve(`react-hot-loader/package.json`)
              ),
            }
          : {}),
        "react-lifecycles-compat": directoryPath(
          `.cache/react-lifecycles-compat.js`
        ),
        "create-react-context": directoryPath(`.cache/create-react-context.js`),
        "@pmmmwh/react-refresh-webpack-plugin": path.dirname(
          require.resolve(`@pmmmwh/react-refresh-webpack-plugin/package.json`)
        ),
        "socket.io-client": path.dirname(
          require.resolve(`socket.io-client/package.json`)
        ),
      },
      plugins: [
        // Those two folders are special and contain gatsby-generated files
        // whose dependencies should be resolved through the `gatsby` package
        PnpWebpackPlugin.bind(directoryPath(`.cache`), module),
        PnpWebpackPlugin.bind(directoryPath(`public`), module),
        // Transparently resolve packages via PnP when needed; noop otherwise
        PnpWebpackPlugin,
      ],
    }

    const target =
      stage === `build-html` || stage === `develop-html` ? `node` : `web`
    if (target === `web`) {
      // force to use es modules when importing internals of @reach.router
      // for browser bundles
      resolve.alias[`@reach/router`] = path.join(
        path.dirname(require.resolve(`@reach/router/package.json`)),
        `es`
      )
    }

    if (stage === `build-javascript` && program.profile) {
      resolve.alias[`react-dom$`] = `react-dom/profiling`
      resolve.alias[`scheduler/tracing`] = `scheduler/tracing-profiling`
    }
    return resolve
  }

  function getResolveLoader() {
    const root = [path.resolve(directory, `node_modules`)]

    const userLoaderDirectoryPath = path.resolve(directory, `loaders`)

    try {
      if (fs.statSync(userLoaderDirectoryPath).isDirectory()) {
        root.push(userLoaderDirectoryPath)
      }
    } catch (err) {
      debug(`Error resolving user loaders directory`, err)
    }

    return {
      modules: [...root, path.join(__dirname, `../loaders`), `node_modules`],
      // Bare loaders should always be loaded via the user dependencies (loaders
      // configured via third-party like gatsby use require.resolve)
      plugins: [PnpWebpackPlugin.moduleLoader(`${directory}/`)],
    }
  }

  const config = {
    // Context is the base directory for resolving the entry option.
    context: directory,
    entry: getEntry(),
    output: getOutput(),

    module: getModule(),
    plugins: getPlugins(),

    // Certain "isomorphic" packages have different entry points for browser
    // and server (see
    // https://github.com/defunctzombie/package-browser-field-spec); setting
    // the target tells webpack which file to include, ie. browser vs main.
    target: stage === `build-html` || stage === `develop-html` ? `node` : `web`,

    devtool: getDevtool(),
    // Turn off performance hints as we (for now) don't want to show the normal
    // webpack output anywhere.
    performance: {
      hints: false,
    },
    mode: getMode(),

    resolveLoader: getResolveLoader(),
    resolve: getResolve(stage),

    node: {
      __filename: true,
    },
  }

  if (stage === `build-javascript`) {
    const componentsCount = store.getState().components.size
    const isCssModule = module => module.type === `css/mini-extract`

    const splitChunks = {
      chunks: `all`,
      cacheGroups: {
        default: false,
        vendors: false,
        framework: {
          chunks: `all`,
          name: `framework`,
          // This regex ignores nested copies of framework libraries so they're bundled with their issuer.
          test: new RegExp(
            `(?<!node_modules.*)[\\\\/]node_modules[\\\\/](${FRAMEWORK_BUNDLES.join(
              `|`
            )})[\\\\/]`
          ),
          priority: 40,
          // Don't let webpack eliminate this chunk (prevents this chunk from becoming a part of the commons chunk)
          enforce: true,
        },
        // if a module is bigger than 160kb from node_modules we make a separate chunk for it
        lib: {
          test(module) {
            return (
              !isCssModule(module) &&
              module.size() > 160000 &&
              /node_modules[/\\]/.test(module.identifier())
            )
          },
          name(module) {
            const hash = crypto.createHash(`sha1`)
            if (!module.libIdent) {
              throw new Error(
                `Encountered unknown module type: ${module.type}. Please open an issue.`
              )
            }

            hash.update(module.libIdent({ context: program.directory }))

            return hash.digest(`hex`).substring(0, 8)
          },
          priority: 30,
          minChunks: 1,
          reuseExistingChunk: true,
        },
        commons: {
          name: `commons`,
          // if a chunk is used on all components we put it in commons (we need at least 2 components)
          minChunks: Math.max(componentsCount, 2),
          priority: 20,
        },
        // If a chunk is used in at least 2 components we create a separate chunk
        shared: {
          test(module) {
            return !isCssModule(module)
          },
          name(module, chunks) {
            const hash = crypto
              .createHash(`sha1`)
              .update(chunks.reduce((acc, chunk) => acc + chunk.name, ``))
              .digest(`hex`)

            return hash
          },
          priority: 10,
          minChunks: 2,
          reuseExistingChunk: true,
        },

        // Bundle all css & lazy css into one stylesheet to make sure lazy components do not break
        // TODO make an exception for css-modules
        styles: {
          test(module) {
            return isCssModule(module)
          },

          name: `styles`,
          priority: 40,
          enforce: true,
        },
      },
      // We load our pages async through async-requires, maxInitialRequests doesn't have an effect on chunks derived from page components.
      // By default webpack has set maxAsyncRequests to 6, in some cases this isn't enough an actually makes the bundle size blow up.
      // We've set maxAsyncRequests to Infinity to negate this. This could potentionally exceed the 25 initial requests that we set before
      // sadly I do not have a better solution.
      maxAsyncRequests: Infinity,
      maxInitialRequests: 25,
      minSize: 20000,
    }

    config.optimization = {
      runtimeChunk: {
        name: `webpack-runtime`,
      },
      // use hashes instead of ids for module identifiers
      // TODO update to deterministic in webpack 5 (hashed is deprecated)
      // @see https://webpack.js.org/guides/caching/#module-identifiers
      moduleIds: `hashed`,
      splitChunks,
      minimizer: [
        // TODO: maybe this option should be noMinimize?
        !program.noUglify &&
          plugins.minifyJs(
            program.profile
              ? {
                  terserOptions: {
                    keep_classnames: true,
                    keep_fnames: true,
                  },
                }
              : {}
          ),
        plugins.minifyCss(),
      ].filter(Boolean),
    }
  }

  if (stage === `build-html` || stage === `develop-html`) {
    // Packages we want to externalize to save some build time
    // https://github.com/gatsbyjs/gatsby/pull/14208#pullrequestreview-240178728
    const externalList = [
      `@reach/router/lib/history`,
      `@reach/router`,
      `common-tags`,
      /^core-js\//,
      `crypto`,
      `debug`,
      `fs`,
      `https`,
      `http`,
      `lodash`,
      `path`,
      `semver`,
      /^lodash\//,
      `zlib`,
    ]

    // Packages we want to externalize because meant to be user-provided
    const userExternalList = [`react-helmet`, `react`, /^react-dom\//]

    const checkItem = (item, request) => {
      if (typeof item === `string` && item === request) {
        return true
      } else if (item instanceof RegExp && item.test(request)) {
        return true
      }
      return false
    }

    const isExternal = request => {
      if (externalList.some(item => checkItem(item, request))) {
        return `umd ${require.resolve(request)}`
      }
      if (userExternalList.some(item => checkItem(item, request))) {
        return `umd ${request}`
      }
      return null
    }

    config.externals = [
      function (context, request, callback) {
        const external = isExternal(request)
        if (external !== null) {
          callback(null, external)
        } else {
          callback()
        }
      },
    ]
  }

  store.dispatch(actions.replaceWebpackConfig(config))
  const getConfig = () => store.getState().webpack

  await apiRunnerNode(`onCreateWebpackConfig`, {
    getConfig,
    stage,
    rules,
    loaders,
    plugins,
    parentSpan,
  })

  return getConfig()
}
