import { build } from 'esbuild'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const outfile = 'server/lib/defuddle-bundle.mjs'
const lockfile = resolve('node_modules/.package-lock.json')

// Skip rebuild if bundle exists and is newer than lockfile (deps unchanged)
if (existsSync(outfile) && existsSync(lockfile)) {
  const bundleMtime = statSync(outfile).mtimeMs
  const lockMtime = statSync(lockfile).mtimeMs
  if (bundleMtime > lockMtime) {
    process.exit(0)
  }
}

await build({
  entryPoints: ['node_modules/defuddle/dist/node.js'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'esnext',
  outfile,
  mainFields: ['module', 'main'],
  minify: true,
})

console.log('Bundled defuddle/node → server/lib/defuddle-bundle.mjs')
