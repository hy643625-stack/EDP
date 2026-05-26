import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptDir, '..')

const platform = process.platform
const arch = process.arch === 'x64' ? 'x64' : 'arm64'
const esbuildPkg = `@esbuild/${platform}-${arch}`
const esbuildBin = resolve(frontendDir, 'node_modules', esbuildPkg, 'bin', 'esbuild')

if (!existsSync(esbuildBin)) {
  console.error(`[check] Missing esbuild binary: ${esbuildBin}`)
  console.error('[hint] Run `npm install` in the frontend directory to restore the toolchain.')
  process.exit(1)
}

const result = spawnSync(esbuildBin, ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
})

if (result.error) {
  console.error(`[check] Failed to spawn esbuild: ${result.error.message}`)
  console.error('[hint] esbuild binary may be blocked or corrupted. Reinstall frontend dependencies and recheck.')
  process.exit(1)
}

if (result.status !== 0) {
  const details = (result.stderr || result.stdout || '').trim()
  console.error(`[check] esbuild exited with status ${result.status}.`)
  if (details) {
    console.error(details)
  }
  console.error('[hint] esbuild install is incomplete. Reinstall frontend dependencies and recheck.')
  process.exit(result.status ?? 1)
}

console.log(`[check] esbuild ready: ${result.stdout.trim()}`)
