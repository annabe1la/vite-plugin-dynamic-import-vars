import path from 'path'
import type { Alias, ResolvedConfig } from 'vite'
import { normalizePath } from 'vite'
import { extractImportVarsRE } from './utils'

export interface AliasReplaced {
  alias: Alias
  importVars: string
  replacedImportVars: string
}

export class AliasContext {
  constructor(
    private config: ResolvedConfig,
    private resolve = config.createResolver({
      preferRelative: true,
      tryIndex: false,
      extensions: []
    })
  ) {}
  public replaceImportVars(importVars: string, id: string) {
    return this.replaceVars(importVars, id, false)
  }
  public replaceRawImportVars(rawImportVars: string, id: string) {
    return this.replaceVars(rawImportVars, id, true)
  }
  private async replaceVars(importVars: string, id: string, raw: boolean): Promise<AliasReplaced | void> {
    let [startQuotation, ipte] = ['', importVars, '']
    if (raw) {
      const matched = importVars.match(extractImportVarsRE)
      if (matched) {
        [, startQuotation, ipte] = matched
      }
    }

    const resolvedId = await this.resolve(ipte, id, true)
    if (!resolvedId) return

    // If multiple `e.replacement` are the same, there will be a problem
    // 🐞 const alias = this.config.resolve.alias.find(e => resolvedId.startsWith(e.replacement))

    const alias = this.config.resolve.alias.find(
      // https://github.com/rollup/plugins/blob/8fadc64c679643569239509041a24a9516baf340/packages/alias/src/index.ts#L16
      e => e.find instanceof RegExp ? e.find.test(ipte) : ipte.startsWith(e.find + '/')
    )
    if (!alias) return
    const { find, replacement } = alias

    if (replacement.startsWith('.')) {
      // Considered a relative path
      ipte = ipte.replace(find, replacement)
    } else {
      const normalId = normalizePath(id)
      const normalReplacement = normalizePath(replacement)

      // Compatible with vite restrictions
      // https://github.com/vitejs/vite/blob/1e9615d8614458947a81e0d4753fe61f3a277cb3/packages/vite/src/node/plugins/importAnalysis.ts#L672
      let relativePath = path.relative(
        // Usually, the `replacement` we use is the directory path
        // So we also use the `path.dirname` path for calculation
        path.dirname(/* 🚧-① */normalId),
        normalReplacement,
      )
      if (relativePath === '') {
        relativePath = /* 🚧-③ */'.'
      }
      const relativeImportee = relativePath + '/' + ipte
        .replace(find, '')
        // Remove the beginning /
        .replace(/^\//, '')
      ipte = relativeImportee
    }

    return {
      alias,
      importVars,
      replacedImportVars: raw ? (startQuotation + ipte) : ipte,
    }
  }
}
