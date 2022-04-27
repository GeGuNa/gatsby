const _ = require(`lodash`)
const path = require(`path`)

function unstable_shouldOnCreateNode({ node }) {
  // We only care about JSON content.
  return node.internal.mediaType === `application/json`
}

const typeCache = new Map()

async function onCreateNode(
  { node, actions, loadNodeContent, createNodeId, createContentDigest },
  pluginOptions
) {
  if (!unstable_shouldOnCreateNode({ node })) {
    return
  }

  function getType({ node, object, isArray }) {
    if (pluginOptions && _.isFunction(pluginOptions.typeName)) {
      return pluginOptions.typeName({ node, object, isArray })
    } else if (pluginOptions && _.isString(pluginOptions.typeName)) {
      return pluginOptions.typeName
    } else if (node.internal.type !== `File`) {
      if (typeCache.has(node.internal.type)) {
        return typeCache.get(node.internal.type)
      } else {
        const type = _.upperFirst(_.camelCase(`${node.internal.type} Json`))
        typeCache.set(node.internal.type, type)
        return type
      }
    } else if (isArray) {
      if (typeCache.has(node.name)) {
        return typeCache.get(node.name)
      } else {
        const type = _.upperFirst(_.camelCase(`${node.name} Json`))
        typeCache.set(node.name, type)
        return type
      }
    } else {
      if (typeCache.has(node.dir)) {
        return typeCache.get(node.dir)
      } else {
        const type = _.upperFirst(
          _.camelCase(`${path.basename(node.dir)} Json`)
        )
        typeCache.set(node.dir, type)
        return type
      }
    }
  }

  function transformObject(obj, id, type) {
    const jsonNode = {
      ...obj,
      id,
      children: [],
      parent: node.id,
      internal: {
        contentDigest: createContentDigest(obj),
        type,
      },
    }
    if (obj.id) {
      jsonNode[`jsonId`] = obj.id
    }
    createNode(jsonNode)
    createParentChildLink({ parent: node, child: jsonNode })
  }

  const { createNode, createParentChildLink } = actions

  const content = await loadNodeContent(node)
  let parsedContent
  try {
    parsedContent = JSON.parse(content)
  } catch {
    const hint = node.absolutePath
      ? `file ${node.absolutePath}`
      : `in node ${node.id}`
    throw new Error(`Unable to parse JSON: ${hint}`)
  }

  async function transformArrayChunk(chunk) {
    for (let i = 0, l = chunk.length; i < l; i++) {
      const obj = chunk[i]
      transformObject(
        obj,
        createNodeId(`${node.id} [${i}] >>> JSON`),
        getType({
          node,
          object: obj,
          isArray: true,
        })
      )
      await new Promise(resolve =>
        setImmediate(() => {
          resolve()
        })
      )
    }
  }

  if (_.isArray(parsedContent)) {
    for (const chunk of _.chunk(parsedContent, 100)) {
      await transformArrayChunk(chunk)
    }
  } else if (_.isPlainObject(parsedContent)) {
    transformObject(
      parsedContent,
      createNodeId(`${node.id} >>> JSON`),
      getType({ node, object: parsedContent, isArray: false })
    )
  }
}

exports.unstable_shouldOnCreateNode = unstable_shouldOnCreateNode
exports.onCreateNode = onCreateNode
