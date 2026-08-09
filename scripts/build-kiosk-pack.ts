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

/**
 * Upload the zip to Storage.
 *
 * More care than this looks like it needs, because of a dual-package hazard.
 * The SDK picks the file out of the request payload with
 *
 *     value instanceof File || value instanceof InputFile
 *
 * comparing against ITS OWN copies of those classes. `node-appwrite` ships
 * both CJS and ESM builds, `tsx` runs this script as CJS, and a dynamic
 * `await import('node-appwrite/file')` therefore hands back the *ESM* class —
 * a different object from the CJS one the client checks against. The
 * `instanceof` fails and the SDK reports "File not found in payload", which
 * says nothing at all about the real cause.
 *
 * So: resolve `InputFile` through `require()`, matching how the client itself
 * was loaded, and keep a fallback for the day the loader flips to ESM.
 * `globalThis.File` is the escape hatch — measured, the SDK's `File` IS the
 * global one, so that identity cannot drift. It costs chunking (the whole
 * file goes in one request), which is why it is the fallback and not the
 * default: today's pack is 4 MB, but a future one that bundles a Node runtime
 * would be ~80 MB and wants chunks.
 */
async function uploadZip(
  storage: { createFile(bucket: string, id: string, file: unknown): Promise<unknown> },
  fileId: string,
  zipPath: string,
): Promise<void> {
  const { createRequire } = await import('node:module')
  try {
    const require_ = createRequire(__filename)
    const { InputFile } = require_('node-appwrite/file') as {
      InputFile: { fromPath(p: string, name?: string): unknown }
    }
    await storage.createFile(BUCKETS.kiosk_downloads, fileId, InputFile.fromPath(zipPath, ZIP_NAME))
    return
  } catch (e) {
    if (!/File not found in payload/.test(e instanceof Error ? e.message : String(e))) throw e
    console.log('  ! InputFile identity mismatch — falling back to a single-shot upload')
  }

  const bytes = readFileSync(zipPath)
  await storage.createFile(
    BUCKETS.kiosk_downloads,
    fileId,
    new File([new Uint8Array(bytes)], ZIP_NAME, { type: 'application/zip' }),
  )
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

  // --- 4. installer + acceptance check -------------------------------------
  cpSync(path.join(NATIVE, 'pack-install.cmd'), path.join(OUT, 'install.cmd'))
  console.log('  ✓ install.cmd')

  // Ships WITH the pack, not just in the repo. On a multi-machine rollout the
  // person standing at kiosk #5 has no checkout to run this from, and "is it
  // running?" is not the question that matters — "did the MACHINE start it, or
  // did I?" is, because only the second one survives a reboot with nobody
  // logged in.
  cpSync(path.join(NATIVE, 'check-service.ps1'), path.join(OUT, 'check-install.ps1'))
  console.log('  ✓ check-install.ps1')

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
  await uploadZip(storage, FILE_ID, zipPath)
  console.log(`  ✓ published to ${BUCKETS.kiosk_downloads}/${FILE_ID}`)
  console.log('\n  Operators download it from /api/kiosk-pack while signed in as an admin.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
