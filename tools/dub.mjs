// The narration over the picture.
//
// The lines are the storyboard's own (`tools/demo.json`), written by `npm run voice`, and the picture is the one the
// recorder made. Each line is placed at the second its scene begins, which is read from `.demo/demo-times.json`, so the
// voice and the caption can only ever be about the same scene.
//
//   npm run dub
//
// A line is checked against the picture before anything is written: one that runs into the next, or past the last frame,
// stops the run instead of being mixed quietly.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const voice = JSON.parse(readFileSync(join(ROOT, 'tools/voice.json'), 'utf8'));
const times = JSON.parse(readFileSync(join(ROOT, '.demo/demo-times.json'), 'utf8'));
const voiced = JSON.parse(readFileSync(join(ROOT, '.demo/voice-times.json'), 'utf8'));
const source = join(ROOT, '.demo/skene-theoros.mp4');

/** How long a file plays, in seconds. */
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

const placed = voiced.lines.filter(Boolean).map((line) => {
  const scene = times.scenes[line.index - 1];
  if (!scene) throw new Error(`line ${line.index} has no scene`);
  return { ...line, at: scene.from + 0.12, scene };
});

for (let index = 1; index < placed.length; index += 1) {
  const before = placed[index - 1];
  const line = placed[index];
  if (line.at < before.at + before.length + 0.05) {
    throw new Error(`line ${line.index} starts at ${line.at.toFixed(2)}s and line ${before.index} runs to ${(before.at + before.length).toFixed(2)}s`);
  }
}

const end = secondsOf(source);
const last = placed[placed.length - 1];
if (last.at + last.length > end) {
  throw new Error(`the narration runs to ${(last.at + last.length).toFixed(2)}s and the picture ends at ${end.toFixed(2)}s`);
}

for (const line of placed) {
  console.log(`${line.at.toFixed(2)}s +${line.length.toFixed(2)}s  ${line.text}`);
}

const delays = placed.map((line, index) => `[${index + 1}]adelay=${Math.round(line.at * 1000)}:all=1[a${index + 1}]`);
const mixed = placed.map((_, index) => `[a${index + 1}]`).join('');
const rendered = spawnSync('ffmpeg', [
  '-y',
  '-i', source,
  ...placed.flatMap((line) => ['-i', line.file]),
  '-filter_complex',
  `${delays.join(';')};${mixed}amix=inputs=${placed.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[a]`,
  '-map', '0:v',
  '-map', '[a]',
  '-c:v', 'copy',
  '-c:a', 'aac',
  '-b:a', '192k',
  // The voice is 24 kHz mono, and an AAC stream at that rate cannot take a bitrate this large.
  '-ar', '48000',
  '-ac', '2',
  '-shortest',
  '-movflags', '+faststart',
  join(ROOT, voice.out),
], { encoding: 'utf8' });
if (rendered.status !== 0) throw new Error(`ffmpeg could not write the dub:\n${rendered.stderr}`);

console.log(`dub: ${voice.out}, ${placed.length} lines over ${end.toFixed(2)}s`);
