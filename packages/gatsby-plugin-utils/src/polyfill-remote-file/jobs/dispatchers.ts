import path from "path"
import { getGatsbyVersion } from "../utils/get-gatsby-version"
import { generateFileUrl, generateImageUrl } from "../utils/url-generator"
import type { Actions } from "gatsby"

export function shouldDispatch(): boolean {
  return (
    !(
      process.env.GATSBY_CLOUD_IMAGE_CDN === `1` ||
      process.env.GATSBY_CLOUD_IMAGE_CDN === `true`
    ) && process.env.NODE_ENV === `production`
  )
}

export function dispatchLocalFileServiceJob(
  {
    url,
    filename,
    contentDigest,
  }: { url: string; filename: string; contentDigest: string },
  actions: Actions
): void {
  const GATSBY_VERSION = getGatsbyVersion()
  const publicUrl = generateFileUrl({
    url,
    filename,
  }).split(`/`)

  publicUrl.unshift(`public`)
  // get filename and remove querystring
  const outputFilename = publicUrl.pop()?.split(`?`)[0]

  actions.createJobV2(
    {
      name: `FILE_CDN`,
      inputPaths: [],
      // we know it's an image so we just mimic an image
      outputDir: path.join(
        global.__GATSBY?.root || process.cwd(),
        ...publicUrl.filter(Boolean)
      ),
      args: {
        url,
        filename: outputFilename,
        contentDigest,
      },
    },
    {
      name: `gatsby`,
      // @ts-ignore - version is allowed
      version: GATSBY_VERSION,
      resolve: __dirname,
    }
  )
}

export function dispatchLocalImageServiceJob(
  {
    url,
    filename,
    mimeType,
    contentDigest,
  }: {
    url: string
    filename: string
    mimeType: string
    contentDigest: string
  },
  imageArgs: Parameters<typeof generateImageUrl>[1],
  actions: Actions
): void {
  const GATSBY_VERSION = getGatsbyVersion()
  const publicUrl = generateImageUrl(
    { url, mimeType, filename },
    imageArgs
  ).split(`/`)
  publicUrl.unshift(`public`)
  // get filename and remove querystring
  const outputFilename = publicUrl.pop()?.split(`?`)[0]

  actions.createJobV2(
    {
      name: `IMAGE_CDN`,
      inputPaths: [],
      outputDir: path.join(
        global.__GATSBY?.root || process.cwd(),
        ...publicUrl.filter(Boolean)
      ),
      args: {
        url,
        filename: outputFilename,
        contentDigest,
        ...imageArgs,
      },
    },
    {
      name: `gatsby`,
      // @ts-ignore - version is allowed
      version: GATSBY_VERSION,
      resolve: __dirname,
    }
  )
}
