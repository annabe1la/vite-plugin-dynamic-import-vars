import { existsSync, readFileSync } from 'fs'
import path from 'path'
import type { ResolvedConfig } from 'vite'
import { normalizePath } from 'vite'

export function getDepsCacheDir(config: ResolvedConfig) {
  return normalizePath(path.resolve(config.cacheDir, 'deps'))
}

function parseOptimizedDepsMetadata(
  jsonMetadata: string,
  depsCacheDir: string,
) {
  const metadata = JSON.parse(jsonMetadata, (key: string, value: string) => {
    // Paths can be absolute or relative to the deps cache dir where
    // the _metadata.json is located
    if (key === 'file' || key === 'src')
      return normalizePath(path.resolve(depsCacheDir, value))

    return value
  })

  return metadata
}

export const getModuleId = (id: string, config: ResolvedConfig) => {
  const depsCacheDir = getDepsCacheDir(config)

  const metadataPath = path.join(depsCacheDir, '_metadata.json')

  if (!existsSync(metadataPath))
    return null

  const metadata = parseOptimizedDepsMetadata(
    readFileSync(metadataPath, 'utf-8'),
    depsCacheDir,
  )

  if (metadata && Reflect.has(metadata?.optimized, id))
    return Reflect.get(metadata?.optimized, id)

  return null
}

export interface DynamicImportRuntime {
  name: string
  body: string
}

export function generateDynamicImportRuntime(
  // localFilename: Array<possible importVars>,
  entries: Record<string, string[]>,
  dynamicImportIndex: number | string,
): DynamicImportRuntime {
  const name = `__variableDynamicImportRuntime${dynamicImportIndex}__`
  const cases = Object.entries(entries).map(([localFile, importVarsList]) => {
    const c = importVarsList.map(importVars => `    case '${importVars}':`)
    return `${c.join('\n')}
      return import('${localFile}');
`
  })

  const body = `
function ${name}(path) {
  switch (path) {
${cases.join('\n')}
    default: return new Promise(function(resolve, reject) {
      (typeof queueMicrotask === 'function' ? queueMicrotask : setTimeout)(
        reject.bind(null, new Error("Unknown variable dynamic import: " + path))
      );
    })
  }
}
`
  return { name, body }
}
