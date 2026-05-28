const [majorRaw] = process.versions.node.split('.')
const major = Number(majorRaw)

if (!Number.isFinite(major) || major < 20) {
  console.error(
    `EveryDayPerfect frontend expects Node.js >=20. Current version: ${process.version}. ` +
      'Use Node 20 LTS or newer.'
  )
  process.exit(1)
}
