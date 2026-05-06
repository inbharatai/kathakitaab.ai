// ============================================================
// scripts/build-mood-music.ts
//
// Generates the procedural ambient WAV files referenced by the
// Remotion BookMovie composition (and anything else that wants
// a mood bed). Output: public/audio/mood/{mood}.wav.
//
// Run:
//   npx tsx scripts/build-mood-music.ts
//
// Re-run only when proceduralWav.ts voicings change. Output is
// stable for a given mood and duration, so the WAV bytes are
// deterministic enough to commit if you want.
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { synthesizeMoodWav, MOOD_NAMES } from '../lib/audio/proceduralWav';

const OUT_DIR = join(process.cwd(), 'public', 'audio', 'mood');

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const mood of MOOD_NAMES) {
    const buf = synthesizeMoodWav(mood);
    const path = join(OUT_DIR, `${mood}.wav`);
    writeFileSync(path, buf);
    console.log(`[mood-music] wrote ${path} (${(buf.length / 1024).toFixed(1)} KiB)`);
  }
  console.log(`[mood-music] done. ${MOOD_NAMES.length} files in ${OUT_DIR}`);
}

main();
