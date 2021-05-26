import { startRedirectListener } from "./redirects-writer"
import {
  IBuildContext,
  initialize,
  customizeSchema,
  sourceNodes,
  buildSchema,
  createPages,
  extractQueries,
  writeOutRedirects,
  postBootstrap,
  rebuildSchemaWithSitePage,
} from "../services"
import { Runner, createGraphQLRunner } from "./create-graphql-runner"
import reporter from "gatsby-cli/lib/reporter"
import { globalTracer } from "opentracing"
// import JestWorker from "jest-worker"
import { handleStalePageData } from "../utils/page-data"
import {
  buildSchemaInWorkers,
  loadConfigInWorkers,
  setExtractedQueriesInWorkers,
} from "../utils/worker/pool"
import type { IGatsbyWorkerPool } from "../utils/worker/types"

const tracer = globalTracer()

export async function bootstrap(
  initialContext: Partial<IBuildContext>
): Promise<{
  gatsbyNodeGraphQLFunction: Runner
  workerPool: IGatsbyWorkerPool
}> {
  const spanArgs = initialContext.parentSpan
    ? { childOf: initialContext.parentSpan }
    : {}

  const parentSpan = tracer.startSpan(`bootstrap`, spanArgs)

  const bootstrapContext: IBuildContext & {
    shouldRunCreatePagesStatefully: boolean
  } = {
    ...initialContext,
    parentSpan,
    shouldRunCreatePagesStatefully: true,
  }

  const context = {
    ...bootstrapContext,
    ...(await initialize(bootstrapContext)),
  }

  // This is async but we don't need to wait for it here
  // (jest-worker will queue tasks). We can continue with main process
  // bootstrap
  loadConfigInWorkers(context.workerPool, context.store.getState().program)

  await customizeSchema(context)
  await sourceNodes(context)

  await buildSchema(context)

  context.gatsbyNodeGraphQLFunction = createGraphQLRunner(
    context.store,
    reporter
  )

  await createPages(context)

  await handleStalePageData()

  await rebuildSchemaWithSitePage(context)

  // This is async but we don't need to wait for it here
  // (jest-worker will queue tasks). We can continue with main process
  // bootstrap
  buildSchemaInWorkers(
    context.workerPool,
    context.store.getState().inferenceMetadata
  )

  await extractQueries(context)

  // This is async but we don't need to wait for it here
  // (jest-worker will queue tasks). We can continue with main process
  // bootstrap
  setExtractedQueriesInWorkers(
    context.workerPool,
    context.store.getState().components,
    context.store.getState().staticQueryComponents
  )

  await writeOutRedirects(context)

  startRedirectListener()

  await postBootstrap(context)

  parentSpan.finish()

  return {
    gatsbyNodeGraphQLFunction: context.gatsbyNodeGraphQLFunction,
    workerPool: context.workerPool,
  }
}
