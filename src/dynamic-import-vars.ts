import path from 'node:path';

import fastGlob from 'fast-glob';
import type { BaseCallExpression, BinaryExpression, Expression, TemplateLiteral } from "estree";

export class VariableDynamicImportError extends Error {}

/* eslint-disable-next-line no-template-curly-in-string */
const example = 'For example: import(`./foo/${bar}.js`).';

function sanitizeString(str: string) {
  if (str === '') return str;
  if (str.includes('*')) {
    throw new VariableDynamicImportError('A dynamic import cannot contain * characters.');
  }
  return fastGlob.escapePath(str);
}

function templateLiteralToGlob(node: TemplateLiteral) {
  let glob = '';

  for (let i = 0; i < node.quasis.length; i += 1) {
    glob += sanitizeString(node.quasis[i].value.raw);
    if (node.expressions[i]) {
      glob += expressionToGlob(node.expressions[i]);
    }
  }

  return glob;
}

function callExpressionToGlob(node: BaseCallExpression) {
  const { callee } = node;
  if (
      callee.type === 'MemberExpression' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'concat'
  ) {
    return `${expressionToGlob((callee.object) as Expression)}${(node.arguments as Expression[]).map(expressionToGlob).join('')}`;
  }
  return '*'
}

function binaryExpressionToGlob(node: BinaryExpression) {
  if (node.operator !== '+') {
    throw new VariableDynamicImportError(`${node.operator} operator is not supported.`);
  }

  return `${expressionToGlob(node.left)}${expressionToGlob(node.right)}`;
}

function expressionToGlob(node: Expression): string {
  switch (node.type) {
    case 'TemplateLiteral':
      // import(`./foo/${bar}`)
      return templateLiteralToGlob(node)
    case 'CallExpression':
      // import('./foo/'.concat(bar))
      return callExpressionToGlob(node)
    case 'BinaryExpression':
      // import('./foo/' + bar)
      return binaryExpressionToGlob(node)
    case 'Literal':
      // import('./foo/bar')
      return sanitizeString(String(node.value)) // Recursive output
    default: 'Identifier'
      return '*'
  }
}

const defaultProtocol = 'file:';
const ignoredProtocols = ['data:', 'http:', 'https:'];

function shouldIgnore(glob: string) :boolean {
  const containsAsterisk = glob.includes('*');

  const globURL = new URL(glob, defaultProtocol);

  const containsIgnoredProtocol = ignoredProtocols.some(
      (ignoredProtocol) => ignoredProtocol === globURL.protocol
  );

  return !containsAsterisk || containsIgnoredProtocol;
}

export function dynamicImportToGlob(node: Expression, sourceString: string) {
  let glob = expressionToGlob(node);

  if (shouldIgnore(glob)) {
    return null;
  }
  glob = glob.replace(/\*\*/g, '*')

  if (glob.startsWith('*')) {
    throw new VariableDynamicImportError(
        `invalid import "${sourceString}". It cannot be statically analyzed. Variable dynamic imports must start with ./ and be limited to a specific directory. ${example}`
    );
  }

  if (glob.startsWith('/')) {
    throw new VariableDynamicImportError(
        `invalid import "${sourceString}". Variable absolute imports are not supported, imports must start with ./ in the static part of the import. ${example}`
    );
  }

  if (!glob.startsWith('./') && !glob.startsWith('../')) {
    throw new VariableDynamicImportError(
        `invalid import "${sourceString}". Variable bare imports are not supported, imports must start with ./ in the static part of the import. ${example}`
    );
  }

  // Disallow ./*.ext
  const ownDirectoryStarExtension = /^\.\/\*\.[\w]+$/;
  if (ownDirectoryStarExtension.test(glob)) {
    throw new VariableDynamicImportError(
        `${
            `invalid import "${sourceString}". Variable imports cannot import their own directory, ` +
            'place imports in a separate directory or make the import filename more specific. '
        }${example}`
    );
  }

  if (path.extname(glob) === '') {
    throw new VariableDynamicImportError(
        `invalid import "${sourceString}". A file extension must be included in the static part of the import. ${example}`
    );
  }

  return glob;
}