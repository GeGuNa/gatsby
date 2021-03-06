import fs from "fs-extra"
import path from "path"
import { IGatsbyPage } from "../redux/types"
import { websocketManager } from "./websocket-manager"
import { isWebpackStatusPending } from "./webpack-status"
import { store } from "../redux"

import { IExecutionResult } from "../query/types"

interface IPageData {
  componentChunkName: IGatsbyPage["componentChunkName"]
  matchPath?: IGatsbyPage["matchPath"]
  path: IGatsbyPage["path"]
}

export interface IPageDataWithQueryResult extends IPageData {
  result: IExecutionResult
}

export function fixedPagePath(pagePath: string): string {
  return pagePath === `/` ? `index` : pagePath
}

function getFilePath(publicDir: string, pagePath: string): string {
  return path.join(
    publicDir,
    `page-data`,
    fixedPagePath(pagePath),
    `page-data.json`
  )
}

export async function readPageData(
  publicDir: string,
  pagePath: string
): Promise<IPageDataWithQueryResult> {
  const filePath = getFilePath(publicDir, pagePath)
  const rawPageData = await fs.readFile(filePath, `utf-8`)

  return JSON.parse(rawPageData)
}

export async function removePageData(
  publicDir: string,
  pagePath: string
): Promise<void> {
  const filePath = getFilePath(publicDir, pagePath)

  if (fs.existsSync(filePath)) {
    return await fs.remove(filePath)
  }

  return Promise.resolve()
}

export async function writePageData(
  publicDir: string,
  { componentChunkName, matchPath, path: pagePath }: IPageData
): Promise<IPageDataWithQueryResult> {
  const inputFilePath = path.join(
    publicDir,
    `..`,
    `.cache`,
    `json`,
    `${pagePath.replace(/\//g, `_`)}.json`
  )
  const outputFilePath = getFilePath(publicDir, pagePath)
  const result = await fs.readJSON(inputFilePath)
  const body = {
    componentChunkName,
    path: pagePath,
    matchPath,
    result,
  }
  const bodyStr = JSON.stringify(body)
  // transform asset size to kB (from bytes) to fit 64 bit to numbers
  const pageDataSize = Buffer.byteLength(bodyStr) / 1000

  store.dispatch({
    type: `ADD_PAGE_DATA_STATS`,
    payload: {
      filePath: outputFilePath,
      size: pageDataSize,
    },
  })

  await fs.outputFile(outputFilePath, bodyStr)
  return body
}

let isFlushPending = false
let isFlushing = false

export function isFlushEnqueued(): boolean {
  return isFlushPending
}

export async function flush(): Promise<void> {
  if (isFlushing) {
    // We're already in the middle of a flush
    return
  }
  isFlushPending = false
  isFlushing = true
  const { pendingPageDataWrites, components, pages, program } = store.getState()

  const { pagePaths, templatePaths } = pendingPageDataWrites

  const pagesToWrite = Array.from(templatePaths).reduce(
    (set, componentPath) => {
      const templateComponent = components.get(componentPath)
      if (templateComponent) {
        templateComponent.pages.forEach(set.add.bind(set))
      }
      return set
    },
    new Set(pagePaths.values())
  )

  for (const pagePath of pagesToWrite) {
    const page = pages.get(pagePath)

    // It's a gloomy day in Bombay, let me tell you a short story...
    // Once upon a time, writing page-data.json files were atomic
    // After this change (#24808), they are not and this means that
    // between adding a pending write for a page and actually flushing
    // them, a page might not exist anymore ??????????????????
    // This is why we need this check
    if (page) {
      const result = await writePageData(
        path.join(program.directory, `public`),
        page
      )

      if (program?._?.[0] === `develop`) {
        websocketManager.emitPageData({
          id: pagePath,
          result,
        })
      }
    }
  }

  store.dispatch({
    type: `CLEAR_PENDING_PAGE_DATA_WRITES`,
  })
  isFlushing = false
  return
}

export function enqueueFlush(): void {
  if (isWebpackStatusPending()) {
    isFlushPending = true
  } else {
    flush()
  }
}
