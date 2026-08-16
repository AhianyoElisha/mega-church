/**
 * Generate every size of the church mark from the single source artwork.
 *
 *   npm run build:brand
 *
 * The source (`brand/tmclogo.png`) is 1545×1518 and 1.25 MB — fine as a master,
 * absurd to ship to a browser that renders it at 40px. This produces the sizes
 * the app actually uses and nothing else, so there is one place to regenerate
 * from if the artwork is ever replaced.
 *
 * Outputs (all committed, so a clone does not need sharp to run the app):
 *   public/logo.png                256px  the header / login mark
 *   public/logo@2x.png             512px  retina
 *   app/icon.png                    96px  browser tab favicon (Next serves this)
 *   app/apple-icon.png             180px  iOS home-screen icon
 *   public/icon-192.png            192px  PWA install icon
 *   public/icon-512.png            512px  PWA splash icon
 *   public/icon-maskable-512.png   512px  PWA maskable (Android launcher crop)
 *
 * The last three are declared by `app/manifest.ts`. A manifest whose icons 404
 * is an invalid manifest, and an invalid manifest means the app is NOT
 * installable — which on iOS also means the birthday team never receives a
 * push, because Safari only delivers Web Push to an installed PWA.
 */
import path from 'node:path'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import sharp from 'sharp'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'brand', 'tmclogo.png')

type Output = { file: string; size: number; note: string; maskable?: boolean }

const OUTPUTS: Output[] = [
  { file: 'public/logo.png', size: 256, note: 'header / login mark' },
  { file: 'public/logo@2x.png', size: 512, note: 'retina' },
  // Next's file convention: app/icon.png becomes the favicon automatically.
  { file: 'app/icon.png', size: 96, note: 'favicon' },
  { file: 'app/apple-icon.png', size: 180, note: 'iOS home screen' },
  { file: 'public/icon-192.png', size: 192, note: 'PWA install' },
  { file: 'public/icon-512.png', size: 512, note: 'PWA splash' },
  { file: 'public/icon-maskable-512.png', size: 512, note: 'PWA maskable', maskable: true },
]

/** The brand yellow — a maskable icon must fill its whole square. */
const MASKABLE_BACKGROUND = { r: 0xf5, g: 0xb3, b: 0x01, alpha: 1 }

/**
 * Android crops a maskable icon to whatever shape its launcher uses — circle,
 * squircle, teardrop — and only the centre 80% is guaranteed to survive. The
 * mark is drawn at 60% and centred, so the crop eats yellow rather than
 * slicing the crosses off the badge.
 */
const MASKABLE_MARK_RATIO = 0.6

async function main() {
  if (!existsSync(SRC)) {
    console.error(`\n  ✗ Source artwork not found at ${SRC}`)
    process.exit(1)
  }

  const meta = await sharp(SRC).metadata()
  console.log(`Source: ${meta.width}×${meta.height}, ${meta.hasAlpha ? 'RGBA' : 'RGB'}\n`)

  for (const { file, size, note, maskable } of OUTPUTS) {
    const out = path.join(ROOT, file)
    mkdirSync(path.dirname(out), { recursive: true })

    if (maskable) {
      const markSize = Math.round(size * MASKABLE_MARK_RATIO)
      const mark = await sharp(SRC)
        .resize(markSize, markSize, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer()
      await sharp({
        create: { width: size, height: size, channels: 4, background: MASKABLE_BACKGROUND },
      })
        .composite([{ input: mark, gravity: 'centre' }])
        // No `palette: true` here: quantising a photographic mark over a flat
        // brand colour banded the yellow visibly at 512px.
        .png({ compressionLevel: 9 })
        .toFile(out)
    } else {
      await sharp(SRC)
        // `contain` + a transparent background: the mark is a circular badge,
        // so squashing it to a square aspect would visibly distort the crosses.
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9, palette: true })
        .toFile(out)
    }
    // statSync, not sharp's metadata().size — that reports the decoded buffer
    // for a file read from disk, which is 0 here and made every line read "0.0 KB".
    const kb = statSync(out).size / 1024
    console.log(`  ✓ ${file.padEnd(30)} ${String(size).padStart(3)}px  ${kb.toFixed(1)} KB   ${note}`)
  }

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
