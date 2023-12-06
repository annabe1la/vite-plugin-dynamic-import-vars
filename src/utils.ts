export const multilineCommentsRE = /\/\*(.|[\r\n])*?\*\//gm
export const singlelineCommentsRE = /\/\/.*/g
export const queryRE = /\?.*$/s
export const hashRE = /#.*$/s

export const cleanUrl = (url: string): string =>
    url.replace(hashRE, '').replace(queryRE, '')

export const JS_EXTENSIONS = [
  '.mjs',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.cjs'
]
export const KNOWN_SFC_EXTENSIONS = [
  '.vue',
  '.svelte',
]

export const dynamicImportRE = /\bimport[\s\r\n]*?\(/
// this is probably less accurate
export const normallyImportVarsRE = /^\.{1,2}\/[.-/\w]+(\.\w+)$/
// [, startQuotation, importee]
export const extractImportVarsRE = /^([`'"]{1})(.*)$/
export const viteIgnoreRE = /\/\*\s*@vite-ignore\s*\*\//

export function hasDynamicImport(code: string) {
  code = code
    .replace(singlelineCommentsRE, '')
    .replace(multilineCommentsRE, '')
  return dynamicImportRE.test(code)
}

export class MagicString {
  private overwrites: { loc: [number, number]; content: string } [] | undefined
  private starts = ''
  private ends = ''

  constructor(
    public str: string
  ) { }

  public append(content: string) {
    this.ends += content
    return this
  }

  public prepend(content: string) {
    this.starts = content + this.starts
    return this
  }

  public overwrite(start: number, end: number, content: string) {
    if (end < start) {
      throw new Error(`"end" con't be less than "start".`)
    }
    if (!this.overwrites) {
      this.overwrites = []
    }
    this.overwrites.push({ loc: [start, end], content })
    return this
  }

  public toString() {
    let str = this.str
    if (this.overwrites) {
      const arr = [...this.overwrites].sort((a, b) => b.loc[0] - a.loc[0])
      for (const { loc: [start, end], content } of arr) {
        // TODO: check start or end overlap
        str = str.slice(0, start) + content + str.slice(end)
      }
    }
    return this.starts + str + this.ends
  }
}
