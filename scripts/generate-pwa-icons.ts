// Renders the full PWA + Play Store icon set from public/logo.png.
//
// Why a script and not hand-crafted Figma exports:
//   - The brand logo is 79×58 (non-square, small). PWA + Play Store
//     icons must be square, opaque, and up to 1024×1024. Placing the
//     logo on a brand-coloured square is the only way to get there
//     without losing detail to upscaling.
//   - We need separate "regular" and "maskable" variants. Android
//     crops maskable icons to a circle / squircle / rounded-square
//     depending on the launcher, so the meaningful content must sit
//     inside the inner 80% (the "safe zone"). Regular icons fill the
//     full bounds.
//
// Outputs (public/icons/):
//   icon-192.png, icon-256.png, icon-384.png, icon-512.png  — regular
//   icon-maskable-192.png, icon-maskable-512.png             — maskable
//   icon-1024.png                                            — Play Store hi-res
//   apple-touch-icon.png (180×180)                           — iOS home screen
//
// Idempotent. Safe to re-run after changing logo.png.

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOGO = join(process.cwd(), 'public', 'logo.png');
const OUT = join(process.cwd(), 'public', 'icons');

// Brand background — radial saffron-to-deep-earth so the icon reads
// warm against light home-screen wallpapers AND deep against dark ones.
// Mirrors the landing hero radial gradient (radial at top-centre).
function brandBackgroundSVG(size: number): Buffer {
  const cx = size / 2;
  const cy = size * 0.42;
  const r = size * 0.7;
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <radialGradient id="bg" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#E8832A" />
      <stop offset="48%" stop-color="#8B3A0A" />
      <stop offset="100%" stop-color="#0C0806" />
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)" />
</svg>`);
}

async function renderIcon(size: number, opts: { maskable: boolean }): Promise<Buffer> {
  // For maskable variants the logo must sit inside the inner 80% so
  // the launcher's circular / squircle crop doesn't eat the brand.
  // For regular variants we use 70% which looks generous without
  // touching the edge.
  const safeZone = opts.maskable ? 0.65 : 0.70;
  const logoWidthPx = Math.round(size * safeZone);

  // Resize the logo while preserving its 79×58 aspect.
  const resizedLogo = await sharp(LOGO)
    .resize({
      width: logoWidthPx,
      // height auto from aspect
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const logoMeta = await sharp(resizedLogo).metadata();
  const lw = logoMeta.width ?? logoWidthPx;
  const lh = logoMeta.height ?? Math.round(logoWidthPx * (58 / 79));

  // Build the background canvas, then composite the logo centred on it.
  return sharp(brandBackgroundSVG(size))
    .png()
    .composite([{
      input: resizedLogo,
      left: Math.round((size - lw) / 2),
      top: Math.round((size - lh) / 2),
    }])
    .png()
    .toBuffer();
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // Regular icons — used by web manifest "purpose: any" and iOS / favicons.
  const regularSizes = [192, 256, 384, 512];
  for (const size of regularSizes) {
    const buf = await renderIcon(size, { maskable: false });
    writeFileSync(join(OUT, `icon-${size}.png`), buf);
    console.log(`  icon-${size}.png  (${buf.length.toLocaleString()} bytes)`);
  }

  // Maskable icons — Android adaptive icons. Need the inner-80% safe zone.
  for (const size of [192, 512]) {
    const buf = await renderIcon(size, { maskable: true });
    writeFileSync(join(OUT, `icon-maskable-${size}.png`), buf);
    console.log(`  icon-maskable-${size}.png  (${buf.length.toLocaleString()} bytes)`);
  }

  // Play Store hi-res 1024×1024 — required for the store listing.
  const hires = await renderIcon(1024, { maskable: false });
  writeFileSync(join(OUT, 'icon-1024.png'), hires);
  console.log(`  icon-1024.png  (${hires.length.toLocaleString()} bytes)  [Play Store hi-res]`);

  // Apple touch icon — must be 180×180, served at /apple-touch-icon.png.
  const apple = await renderIcon(180, { maskable: false });
  writeFileSync(join(process.cwd(), 'public', 'apple-touch-icon.png'), apple);
  console.log(`  apple-touch-icon.png  (${apple.length.toLocaleString()} bytes)`);

  console.log('\n[icons] done');
}

main().catch(e => {
  console.error('icon generation failed:', e);
  process.exit(1);
});
