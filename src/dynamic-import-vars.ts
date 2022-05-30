import path from 'path'
import type { AliasContext, AliasReplaced } from './alias'
import type { AcornNode } from './types'
import {BaseNode} from "estree-walker";

export interface ImportVarsGlob {
  glob: {
    glob: string
    valid: boolean
  }
  alias?: AliasReplaced
}

export class DynamicImportVars {
  constructor(
    private aliasContext: AliasContext
  ) { }

  public async dynamicImportToGlob(
    node: AcornNode,
    sourceString: string,
    id: string,
  ): Promise<ImportVarsGlob> {
    const result: Partial<ImportVarsGlob> = {}

    const aliasReplacer = async (globImportVars: string) => {
      const replaced = await this.aliasContext.replaceImportVars(globImportVars, id)
      result.alias = replaced as typeof result.alias
      return replaced ? replaced.replacedImportVars : globImportVars
    }
    result.glob = await dynamicImportToGlob(node, sourceString, aliasReplacer)

    return result as ImportVarsGlob
  }
}

// The following part is the `@rollup/plugin-dynamic-import-vars` source code
// https://github.com/rollup/plugins/blob/master/packages/dynamic-import-vars/src/dynamic-import-to-glob.js
class VariableDynamicImportError extends Error { }

/* eslint-disable-next-line no-template-curly-in-string */
const example = 'For example: import(`./foo/${bar}.js`).';

function sanitizeString(str: string) {
  if (str.includes('*')) {
    throw new VariableDynamicImportError('A dynamic import cannot contain * characters.');
  }
  return str;
}

function templateLiteralToGlob(node: any) {
  let glob = '';

  for (let i = 0; i < node.quasis.length; i += 1) {
    glob += sanitizeString(node.quasis[i].value.raw);
    if (node.expressions[i]) { // quasis 永远比 expressions 长一位
      glob += expressionToGlob(node.expressions[i]);
    }
  }

  return glob;
}

function callExpressionToGlob(node: AcornNode): string {
  const { callee } = node;
  if (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'concat'
  ) {
    return `${expressionToGlob(callee.object)}${node.arguments.map(expressionToGlob).join('')}`;
  }
  return '*';
}

function binaryExpressionToGlob(node: AcornNode<any>):string {
  if (node.operator !== '+') {
    throw new VariableDynamicImportError(`${node.operator} operator is not supported.`);
  }

  return `${expressionToGlob(node.left)}${expressionToGlob(node.right)}`;
}


function expressionToGlob(node: AcornNode<any>) {
  switch (node.type) {
    case 'TemplateLiteral':
      // import(`@/pages/${path}`)
      return templateLiteralToGlob(node);
    case 'CallExpression':
      // import('@/pages/'.concat(path))
      return callExpressionToGlob(node);
    case 'BinaryExpression':
      // import('@/pages/' + path)
      return binaryExpressionToGlob(node);
    case 'Literal': {
      // import('@/pages/path')
      return sanitizeString(node.value);
    }
    default:
      return '*';
  }
}

async function dynamicImportToGlob(node: AcornNode<any>, sourceString: string, aliasReplacer: { (globImportVars: string): Promise<string>; (arg0: any): any }) {
  let glob = expressionToGlob(node);
  glob = await aliasReplacer(glob);
  if (!glob.includes('*') || glob.startsWith('data:')) {
    // After `expressiontoglob` processing, it may become a normal path
    return { glob, valid: false };
  }
  glob = glob.replace(/\*\*/g, '*');


  // Disallow ./*.ext
  const ownDirectoryStarExtension = /^\.\/\*\.[\w]+$/;
  if (ownDirectoryStarExtension.test(glob)) {
    throw new VariableDynamicImportError(
      `${`invalid import "${sourceString}". Variable imports cannot import their own directory, ` +
      'place imports in a separate directory or make the import filename more specific. '
      }${example}`
    );
  }

  // 🚧-② This will be handled using `tryFixGlobExtension()`
  // if (path.extname(glob) === '') {
  //   throw new VariableDynamicImportError(
  //     `invalid import "${sourceString}". A file extension must be included in the static part of the import. ${example}`
  //   );
  // }

  return { glob, valid: true };
}

/**
 * ```
 * In some cases, glob may not be available
 * e.g. fill necessary slash
 * `./views*` -> `./views/*`
 * `./views*.js` -> `./views/*.js`
 * ```
 */
export function tryFixGlobSlash(glob: string, depth = true): string | void {
  const extname = path.extname(glob)
  // It could be `./views*.js`, which needs to be repaired to `./views/*.js`
  glob = glob.replace(extname, '')

  // #20
  // @ts-ignore
  const [, importPath] = glob.match(/(.*\/?)\*/)
  if (!importPath.endsWith('/')) {
    // fill necessary slash
    // `./views*` -> `./views/*`
    let fixedGlob = glob.replace(importPath, importPath + '/')

    fixedGlob = depth ? toDepthGlob(fixedGlob) : fixedGlob

    // if it has a '.js' extension
    // `./views/*` -> `./views/*.js`
    fixedGlob += extname

    return fixedGlob
  }
}

/**
 * ```
 * 🚧-② If not extension is not specified, fill necessary extensions
 * e.g.
 * `./views/*`
 *   -> `./views/*.{js,ts,vue ...}`
 *   -> `./views/*` + `/index.{js,ts,vue ...}`
 * ```
 */
export function tryFixGlobExtension(glob: string, extensions: string[]): { globWithIndex?: string; glob: string } | void {
  if (!extensions.includes(path.extname(glob))) {
    // const bareExts = extensions.map(ext => ext.slice(1))
    return {
      globWithIndex: glob.includes('**')
        // `**` including `*/index`
        ? undefined
        : glob + '/index' + `.{${extensions.join(',')}}`,
      glob: glob + `.{${extensions.join(',')}}`,
    }
  }
}

// Match as far as possible
// `./views/*` -> `./views/**/*`
export function toDepthGlob(glob: string): string {
  const extname = path.extname(glob)

  return glob
    .replace(extname, '')
    .replace(/^(.*)(?<!\*\*)\/\*$/, '$1/**/*') + extname
}

export function parseImportExpression(node: BaseNode) {
  let glob = expressionToGlob(node as AcornNode)
  if (!glob.includes('*') || glob.startsWith('data:'))
    return null

  glob = glob.replace(/\*\*/g, '*')

  return glob
}
