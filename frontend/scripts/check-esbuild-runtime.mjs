import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptDir, '..')
const esbuildExe = resolve(frontendDir, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')

if (!existsSync(esbuildExe)) {
  console.error(`[check] Missing esbuild binary: ${esbuildExe}`)
  console.error('[hint] Run `npm.cmd install` in the frontend directory to restore the toolchain.')
  process.exit(1)
}

const result = spawnSync(esbuildExe, ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
})

if (result.error) {
  console.error(`[check] Failed to spawn esbuild: ${result.error.message}`)
  console.error('[hint] Windows likely blocked esbuild. Use Node 20 LTS, allow esbuild.exe in Windows Security or Controlled Folder Access, or retry in an elevated PowerShell window.')
  process.exit(1)
}

if (result.status !== 0) {
  const details = (result.stderr || result.stdout || '').trim()
  console.error(`[check] esbuild exited with status ${result.status}.`)
  if (details) {
    console.error(details)
  }
  console.error('[hint] Windows likely blocked esbuild or the install is incomplete. Reinstall frontend dependencies and recheck.')
  process.exit(result.status ?? 1)
}

console.log(`[check] esbuild ready: ${result.stdout.trim()}`)
