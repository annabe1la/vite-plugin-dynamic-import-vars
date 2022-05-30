import path from 'path'
import type { Plugin, ResolvedConfig } from 'vite'
import fastGlob from 'fast-glob'
import { createFilter } from '@rollup/pluginutils'
import MagicString from 'magic-string'
import {cleanUrl} from "vite-plugin-utils";
import { AliasReplaced, AliasContext} from "./alias"
import { DynamicImportVars, toDepthGlob, tryFixGlobExtension, tryFixGlobSlash, parseImportExpression } from "./dynamic-import-vars"

import {extractImportVarsRE, normallyImportVarsRE} from "./utils";
import {asyncWalk} from "estree-walker";
import {AcornNode} from "./types";
import {generateDynamicImportRuntime, getModuleId} from "./helpers";
import {ImportExpression} from "estree";
type GlobHasFiles = {
  glob: string
  alias?: AliasReplaced & { files: string[] }
  files: string[]
}
type GlobNormally = {
  normally: {
    glob: string
    alias?: AliasReplaced
  }
}
type GlobFilesResult = GlobHasFiles | GlobNormally | null

interface DynamicImportPluginOptions {
  include?: string | string[]
  exclude?: string | string[]
  extensions?: string[]
}

const PLUGIN_NAME = 'vite-plugin-dynamic-import-vars'
const defaultExtensions = ['js', 'cjs', 'ts', 'tsx', 'jsx', 'mjs', 'mts', 'mtsx']

export default function importDynamicModule({ include = [], exclude = [], extensions = defaultExtensions }: DynamicImportPluginOptions = {}): Plugin {
  let config: ResolvedConfig
  let aliasContext: AliasContext
  let dynamicImportVars: DynamicImportVars

  const filterRE = new RegExp(`\\.(?:${extensions.join('|')})$`)

  const filter = createFilter([filterRE, include].flat(), exclude)

  return {
    name: PLUGIN_NAME,
    configResolved(_config) {
      config = _config
      aliasContext = new AliasContext(config)
      dynamicImportVars = new DynamicImportVars(aliasContext)
    },
    async transform(code, id) {
      if(!filter(id)) {
        return null
      }
      const parsed = this.parse(code)
      const globExtensions = config.resolve?.extensions || extensions
      let ms: MagicString
      let dynamicImportIndex = -1

      await asyncWalk(parsed, {
        enter: async (node) => {
          if (node.type !=='ImportExpression') return
          dynamicImportIndex += 1


          const globHead = parseImportExpression((node as ImportExpression).source!)
          if (!globHead)
            return
          if (globHead.startsWith('./') || globHead.startsWith('../'))
            return

          const libPart: string[] = []
          globHead.split('\/').every(i => i.includes('*') || libPart.push(i))
          const libId = path.posix.join(...libPart)

          const moduleId = getModuleId(libId, config)?.src || (await this.resolve(libId, id, { skipSelf: true }))?.id

          if (!moduleId)
            return
          const globResult = await globFiles(
            dynamicImportVars,
            <AcornNode>node,
            code,
            id,
            globExtensions,
            moduleId,
            libId
          )
          const { glob, files, alias } = globResult as GlobHasFiles
          const targetFiles = files.map(file => path.posix.join(libId, file.substring(0, file.indexOf('.'))))
          const importVarsMappings = listImportVarsMappings(
            glob,
            globExtensions,
            targetFiles,
            alias,
          )
          const importRuntime = generateDynamicImportRuntime(importVarsMappings, dynamicImportIndex)

          ms = ms || new MagicString(code)
          ms.prepend(
            importRuntime.body,
          )
          ms.overwrite((node as any).start, (node as any).start + 6, importRuntime.name)

        }
      })
      if (ms!) {
        return {
          code: ms.toString(),
          map: ms.generateMap({
            file: id,
            includeContent: true,
            hires: true,
          }),
        }
      }
      return null
    }
  }
}

async function globFiles(
  dynamicImportVars: DynamicImportVars,
  ImportExpressionNode: AcornNode,
  sourceString: string,
  id: string,
  extensions: string[],
  moduleId: string,
  libId: string
): Promise<GlobFilesResult> {

  const node = ImportExpressionNode
  const code = sourceString
  const pureId = cleanUrl(id)

  const { alias, glob: globObj } = await dynamicImportVars.dynamicImportToGlob(
    node.source,
    code.substring(node.start, node.end),
    pureId,
  )
  if (!globObj.valid) {
    if (normallyImportVarsRE.test(globObj.glob)) {
      return { normally: { glob: globObj.glob, alias } }
    }
    // this was not a variable dynamic import
    return null
  }
  let { glob } = globObj
  let globWithIndex: string | undefined

  glob = tryFixGlobSlash(glob) || glob
  glob = toDepthGlob(glob)
  const tmp = tryFixGlobExtension(glob, extensions)
  if (tmp) {
    glob = tmp.glob
    globWithIndex = tmp.globWithIndex
  } else {
    globWithIndex = ''
  }

  // const parsed = path.parse(pureId)
  const globExtensions = `.\{${extensions.join(',')}\}`
  const globPattern = glob.substring(libId.length).replace('/', '')
  let files = fastGlob.sync(
    globPattern.includes('.') ? globPattern : `${globPattern}${globExtensions}`,
    // globWithIndex ? [glob, globWithIndex] : glob,
    { cwd: path.posix.dirname(moduleId) },
    // { cwd: parsed./* 🚧-① */dir },
  )
  // files = files.map(file => !file.startsWith('.') ? /* 🚧-③ */'./' + file : file)

  let aliasWithFiles: GlobHasFiles['alias']
  if (alias) {
    const static1 = alias.importVars.slice(0, alias.importVars.indexOf('*'))
    const static2 = alias.replacedImportVars.slice(0, alias.replacedImportVars.indexOf('*'))
    aliasWithFiles = {
      ...alias,
      files: files.map(file =>
        // Recovery alias `./views/*` -> `@/views/*`
        file.replace(static2, static1)
      ),
    }
  }

  return {
    glob,
    alias: aliasWithFiles,
    files,
  }
}
function listImportVarsMappings(
  glob: string,
  extensions: string[],
  importVarsList: string[],
  alias?: GlobHasFiles['alias'],
) {
  const hasExtension = extensions.some(ext => glob.endsWith(ext))
  return importVarsList.reduce((memo, importVars, idx) => {
    const realFilepath = importVars
    importVars = alias ? alias.files[idx] : importVars
    if (hasExtension) {
      return Object.assign(memo, { [realFilepath]: [importVars] })
    }

    const ext = extensions.find(ext => importVars.endsWith(ext)) || ''
    const list = [
      // foo/index
      importVars.replace(`.${ext}`, ''),
      // foo/index.js
      importVars,
    ]
    if (importVars.endsWith('index' + ext)) {
      // foo
      list.unshift(importVars.replace('/index' + ext, ''))
    }
    return Object.assign(memo, { [realFilepath]: list })
  }, {} as Record</* localFilename */string, /* Array<possible importVars> */string[]>)
}
