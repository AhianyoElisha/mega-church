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
 *   public/logo.png        256px  the header / login mark
 *   public/logo@2x.png     512px  retina
 *   app/icon.png            96px  browser tab favicon (Next serves this)
 *   app/apple-icon.png     180px  iOS home-screen icon
 */
import path from 'node:path'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import sharp from 'sharp'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'brand', 'tmclogo.png')

const OUTPUTS: { file: string; size: number; note: string }[] = [
  { file: 'public/logo.png', size: 256, note: 'header / login mark' },
  { file: 'public/logo@2x.png', size: 512, note: 'retina' },
  // Next's file convention: app/icon.png becomes the favicon automatically.
  { file: 'app/icon.png', size: 96, note: 'favicon' },
  { file: 'app/apple-icon.png', size: 180, note: 'iOS home screen' },
]

async function main() {
  if (!existsSync(SRC)) {
    console.error(`\n  ✗ Source artwork not found at ${SRC}`)
    process.exit(1)
  }

  const meta = await sharp(SRC).metadata()
  console.log(`Source: ${meta.width}×${meta.height}, ${meta.hasAlpha ? 'RGBA' : 'RGB'}\n`)

  for (const { file, size, note } of OUTPUTS) {
    const out = path.join(ROOT, file)
    mkdirSync(path.dirname(out), { recursive: true })
    await sharp(SRC)
      // `contain` + a transparent background: the mark is a circular badge, so
      // squashing it to a square aspect would visibly distort the crosses.
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, palette: true })
      .toFile(out)
    // statSync, not sharp's metadata().size — that reports the decoded buffer
    // for a file read from disk, which is 0 here and made every line read "0.0 KB".
    const kb = statSync(out).size / 1024
    console.log(`  ✓ ${file.padEnd(22)} ${String(size).padStart(3)}px  ${kb.toFixed(1)} KB   ${note}`)
  }

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
