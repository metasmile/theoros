// The narration, taken from the storyboard.
//
// A scene carries its caption and the sentence spoken over it, so the subtitle and the voice cannot drift apart: they are
// two readings of one record, and a scene with no `say` is a quiet one rather than a scene some other file describes.
//
//   npm run voice
//
// The lines are written to `.demo/voice/lineN.wav` and their lengths to `.demo/voice-times.json`. The recorder reads
// those lengths and holds each scene long enough for its own sentence, so the picture follows the narration instead of a
// second count kept by hand. The model is local: nothing leaves the machine and a re-run is the same audio.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const story = JSON.parse(readFileSync(join(ROOT, 'tools/demo.json'), 'utf8'));
const voice = JSON.parse(readFileSync(join(ROOT, 'tools/voice.json'), 'utf8'));
const LINES = join(ROOT, '.demo/voice');
const TIMES = join(ROOT, '.demo/voice-times.json');

/** How long a file plays, in seconds, which is what tells the recorder how long a scene must hold. */
function secondsOf(path) {
  return Number(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      path,
    ], { encoding: 'utf8' }).trim(),
  );
}

mkdirSync(dirname(LINES), { recursive: true });
// A scene that lost its line must lose its file too, or the mix would still carry the old sentence.
rmSync(LINES, { recursive: true, force: true });
mkdirSync(LINES, { recursive: true });

const lines = [];
for (const [index, scene] of story.scenes.entries()) {
  if (!scene.say) {
    lines.push(null);
    continue;
  }
  const file = join(LINES, `line${index + 1}.wav`);
  execFileSync('voice', [
    'say',
    '-q',
    '-v', voice.voice,
    '-s', String(voice.speed),
    '-o', file,
    scene.say,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  const length = secondsOf(file);
  lines.push({ index: index + 1, file, length, text: scene.say, caption: scene.caption });
  console.log(`${(index + 1).toString().padStart(2)} ${length.toFixed(2)}s  ${scene.say}`);
}

const spoken = lines.filter(Boolean).reduce((sum, line) => sum + line.length, 0);
writeFileSync(TIMES, `${JSON.stringify({ lines, spoken }, null, 2)}\n`);
console.log(`voice: ${lines.filter(Boolean).length} lines, ${spoken.toFixed(2)}s spoken`);
