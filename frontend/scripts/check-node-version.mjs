const [majorRaw] = process.versions.node.split('.')
const major = Number(majorRaw)

if (!Number.isFinite(major) || major < 20 || major >= 25) {
  console.error(
    `EveryDayPerfect frontend expects Node.js >=20 and <25. Current version: ${process.version}. ` +
      'Use Node 20 LTS for stable Vitest runs.'
  )
  process.exit(1)
}
