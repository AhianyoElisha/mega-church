/**
 * Build the kiosk provisioning pack and publish it, so a fresh Windows PC can
 * be set up by downloading a few MB from this app instead of cloning the repo
 * onto it.
 *
 * This is only possible because the server matches fingerprints in-process. A
 * kiosk used to need a local Next server to reach a matcher, which meant the
 * repo, node_modules, an .env.local and therefore an Appwrite key on every
 * machine. Now a PC kiosk needs exactly two things: a browser pointed at this
 * app, and something local that can drive the scanner. That "something" is this
 * pack.
 *
 * The bridge ships as a single esbuild bundle — it imports nothing but node
 * builtins and this repo's own pure modules, so it collapses to ~15 KB with no
 * node_modules at all.
 *
 * Contents:
 *   church-bridge.js                   the bridge, bundled
 *   install.cmd                        self-elevating installer
 *   native/church-scan.exe + ftrScanAPI.dll
 *   native/nbis/install/bin/{cwsq,mindtct,bozorth3}.exe
 *   driver/                            WHQL driver, if exported (optional)
 *   SHA256SUMS.txt
 *
 *   npm run build:kiosk-pack
 *   npx tsx scripts/build-kiosk-pack.ts --no-upload
 *
 * Windows only: it packs Windows binaries and shells out to Compress-Archive.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { createAdminClient } from '../lib/appwrite/server'
import { BUCKETS } from '../lib/appwrite/config'

const ROOT = process.cwd()
const NATIVE = path.join(ROOT, 'tools', 'fingerprint-bridge', 'native')
const OUT = path.join(ROOT, '.kiosk-pack')
const NO_UPLOAD = process.argv.includes('--no-upload')
const VERSION = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const ZIP_NAME = `church-kiosk-pack-${VERSION}.zip`

function die(msg: string): never {
  console.error(`\n  ✗ ${msg}`)
  process.exit(1)
}

/** Windows PE machine type, straight from the COFF header. */
function peMachine(file: string): string {
  const b = readFileSync(file)
  if (b.length < 0x40) return 'unknown'
  const off = b.readInt32LE(0x3c)
  if (off <= 0 || off + 6 >= b.length) return 'unknown'
  if (b[off] !== 0x50 || b[off + 1] !== 0x45) return 'unknown'
  const m = b.readUInt16LE(off + 4)
  return m === 0x014c ? 'i386' : m === 0x8664 ? 'x64' : m === 0xaa64 ? 'arm64' : 'unknown'
}

async function main() {
  console.log('== Building the kiosk pack ==\n')

  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
  mkdirSync(path.join(OUT, 'native', 'nbis', 'install', 'bin'), { recursive: true })

  // --- 1. the bridge, bundled ----------------------------------------------
  // Bundling is what removes the repo from the kiosk. Keep it CJS: the output
  // uses __dirname to find ./native, and that is also what makes the pack
  // relocatable — it runs from wherever the operator unzipped it.
  //
  // esbuild's JS API, not its CLI: through a shell on Windows this repo's own
  // path (`C:\Users\PY TECH\...`) splits on the space and esbuild sees two
  // input files.
  const esbuild = await import('esbuild')
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'tools', 'fingerprint-bridge', 'bridge.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(OUT, 'church-bridge.js'),
    logLevel: 'silent',
  })
  const bridgeKb = (statSync(path.join(OUT, 'church-bridge.js')).size / 1024).toFixed(1)
  console.log(`  ✓ church-bridge.js (${bridgeKb} KB, no dependencies)`)

  // --- 2. native binaries --------------------------------------------------
  const scanExe = path.join(NATIVE, 'church-scan.exe')
  if (!existsSync(scanExe)) {
    die('native/church-scan.exe missing. Build it, or fetch the payload (build-payload.ps1).')
  }
  // The vendor DLL is PE32 i386, so a 64-bit church-scan links fine and then
  // fails at RUNTIME with no_device. Catch it here, not on a kiosk.
  const machine = peMachine(scanExe)
  if (machine !== 'i386') die(`church-scan.exe is ${machine}, expected i386.`)
  cpSync(scanExe, path.join(OUT, 'native', 'church-scan.exe'))
  console.log(`  ✓ church-scan.exe (${machine})`)

  const dll = path.join(NATIVE, 'ftrScanAPI.dll')
  if (existsSync(dll)) {
    cpSync(dll, path.join(OUT, 'native', 'ftrScanAPI.dll'))
    console.log('  ✓ ftrScanAPI.dll')
  } else {
    console.log('  ! ftrScanAPI.dll missing — the pack will not capture until it is added')
  }

  const nbisSrc = path.join(NATIVE, 'nbis', 'install', 'bin')
  for (const exe of ['cwsq.exe', 'mindtct.exe', 'bozorth3.exe']) {
    const from = path.join(nbisSrc, exe)
    if (!existsSync(from)) die(`${exe} missing from ${nbisSrc}. Run build-nbis-win.sh.`)
    cpSync(from, path.join(OUT, 'native', 'nbis', 'install', 'bin', exe))
  }
  console.log('  ✓ cwsq / mindtct / bozorth3')

  // --- 3. driver (optional) ------------------------------------------------
  const driverSrc = path.join(NATIVE, 'driver')
  if (existsSync(driverSrc) && readdirSync(driverSrc).length > 0) {
    cpSync(driverSrc, path.join(OUT, 'driver'), { recursive: true })
    console.log('  ✓ driver (WHQL, installs unattended)')
  } else {
    console.log('  ! no driver/ — run export-driver.ps1 on a PC where the scanner works.')
    console.log('    Without it the pack still installs; the operator installs the')
    console.log('    vendor driver by hand once (install.cmd prints the link).')
  }

  // --- 4. installer --------------------------------------------------------
  cpSync(path.join(NATIVE, 'pack-install.cmd'), path.join(OUT, 'install.cmd'))
  console.log('  ✓ install.cmd')

  // --- 5. manifest ---------------------------------------------------------
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk(OUT)
  const sums = files
    .map((f) => {
      const rel = path.relative(OUT, f).replace(/\\/g, '/')
      const hash = createHash('sha256').update(readFileSync(f)).digest('hex').toUpperCase()
      return `${hash}  ${rel}`
    })
    .sort()
    .join('\n')
  writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), sums + '\n', 'ascii')

  // --- 6. zip --------------------------------------------------------------
  const zipPath = path.join(ROOT, ZIP_NAME)
  if (existsSync(zipPath)) rmSync(zipPath)
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zipPath}'`],
    { stdio: 'pipe' },
  )
  const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(1)
  console.log(`\n  ✓ ${ZIP_NAME} (${mb} MB)`)

  if (NO_UPLOAD) {
    console.log('\n  --no-upload given; not publishing.')
    return
  }

  // --- 7. publish ----------------------------------------------------------
  const { storage } = createAdminClient() as unknown as {
    storage: {
      deleteFile(bucket: string, id: string): Promise<unknown>
      createFile(bucket: string, id: string, file: unknown): Promise<unknown>
    }
  }
  // One file id, overwritten each build, so the download link always means
  // "the current pack" and nobody has to guess which of several is right.
  const FILE_ID = 'current'
  try {
    await storage.deleteFile(BUCKETS.kiosk_downloads, FILE_ID)
  } catch {
    // First publish.
  }
  const { InputFile } = await import('node-appwrite/file')
  await storage.createFile(
    BUCKETS.kiosk_downloads,
    FILE_ID,
    InputFile.fromPath(zipPath, ZIP_NAME),
  )
  console.log(`  ✓ published to ${BUCKETS.kiosk_downloads}/${FILE_ID}`)
  console.log('\n  Operators download it from /api/kiosk-pack while signed in as an admin.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
