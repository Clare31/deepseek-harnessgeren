/**
 * Generate the standard 512px Linux launcher bitmap from the supplied application artwork.
 * Run `pnpm run render:linux-icon` in apps/desktop after replacing resources/icon-linux.png.
 */
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

await sharp(fileURLToPath(new URL('../resources/icon-linux.png', import.meta.url)))
  .resize(512, 512, { fit: 'contain' })
  .png()
  .toFile(fileURLToPath(new URL('../resources/icon-linux-launcher.png', import.meta.url)))
