// The demo, as a script and a recorder.
//
// `tools/demo.json` is the demo: scenes of plain actions and the caption each scene carries. This runs them against
// the app in a headless browser, captures every frame the page paints, and cuts them into an MP4 with the captions
// burned in. Recording the demo again after a UI change is one command, and the script is reviewed like any other
// file here.
//
//   npm run demo
//
// The browser is driven over the Chrome DevTools Protocol rather than through a selector API, because the parts of
// this app that matter are a WebGL canvas and an SVG disc: a wheel on the canvas and a drag on the minimap are pointer
// distances, not elements a query can name. The capture is `Page.startScreencast`, which sends a frame whenever the
// page paints, and each frame is kept with its own timestamp, so the video's motion is the page's own.
//
// The caption is a rendered image and not a font drawn by ffmpeg: this ffmpeg has no drawtext, and a picture is one
// more file to compose rather than a surface to fight.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.DEMO_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.DEMO_PORT ?? 9333);
const FONT = process.env.DEMO_FONT ?? '/System/Library/Fonts/Supplemental/Arial.ttf';

const script = JSON.parse(readFileSync(join(ROOT, 'tools/demo.json'), 'utf8'));
// The narration's own lengths, when `npm run voice` has written them: a scene holds for its sentence.
const voices = existsSync(join(ROOT, '.demo/voice-times.json'))
  ? JSON.parse(readFileSync(join(ROOT, '.demo/voice-times.json'), 'utf8'))
  : null;
const [width, height] = script.size ?? [1920, 1080];
const frames = mkdtempSync(join(tmpdir(), 'theoros-demo-'));
const profile = mkdtempSync(join(tmpdir(), 'theoros-chrome-'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cdp() {
  return awaitJson().then((targets) => {
    const page = targets.find((entry) => entry.type === 'page') ?? targets[0];
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const waiting = new Map();
    const seen = [];
    let next = 0;
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = (next += 1);
        waiting.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && waiting.has(message.id)) {
        waiting.get(message.id)(message.result);
        waiting.delete(message.id);
        return;
      }
      if (message.method !== 'Page.screencastFrame') return;
      const name = `f${String(seen.length + 1).padStart(5, '0')}.jpg`;
      writeFileSync(join(frames, name), Buffer.from(message.params.data, 'base64'));
      seen.push({ name, at: message.params.metadata.timestamp });
      send('Page.screencastFrameAck', { sessionId: message.params.sessionId });
    };
    return new Promise((resolve) => {
      socket.onopen = () => resolve({ socket, send, seen });
    });
  });
}

/** The DevTools endpoint answers only once the browser is listening, so this asks until it does. */
async function awaitJson() {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const answer = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (answer.ok) return await answer.json();
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`chrome did not answer on ${PORT}`);
    await sleep(300);
  }
}

/** One action, as the storyboard names it. A click that finds nothing is reported, because a silent one is a hole. */
async function act(send, [what, a, b]) {
  const evaluate = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true });
    return answer?.result?.value;
  };
  // A list taller than its panel keeps the far rows out of the viewport, so a coordinate taken from the
  // border box lands on whatever is in front of them. Scroll first, settle, then measure.
  const reveal = async (expression) => {
    await evaluate(
      `(() => { const e = ${expression}; if (!e) return null; e.scrollIntoView({ block: 'center' }); return true; })()`,
    );
    await sleep(260);
  };
  const centre = async (selector) => {
    const expression = `document.querySelector(${JSON.stringify(selector)})`;
    await reveal(expression);
    return evaluate(
      `(() => { const e = ${expression}; if (!e) return null;` +
        ` const b = e.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`,
    );
  };
  const press = async (at) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  };

  if (what === 'wait') return sleep(a);
  if (what === 'text') return send('Input.insertText', { text: a });
  if (what === 'key') {
    const code = { Enter: 13, Escape: 27, ArrowRight: 39, ArrowLeft: 37 }[a] ?? 0;
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: a,
        code: a,
        windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code,
      });
    }
    return;
  }
  if (what === 'click') {
    const at = await centre(a);
    if (!at) return console.warn(`demo: no element for ${a}`);
    return press(at);
  }
  if (what === 'clickText' || what === 'clickContains') {
    const match =
      what === 'clickContains'
        ? `(e.textContent || '').includes(${JSON.stringify(a)})`
        : `(e.textContent || '').trim().startsWith(${JSON.stringify(a)})`;
    const expression = `[...document.querySelectorAll('button,[role=button]')].find((e) => ${match})`;
    await reveal(expression);
    const found = await evaluate(
      `(() => { const b = ${expression}; if (!b) return null;` +
        ` const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
    );
    if (!found) return console.warn(`demo: no button for ${a}`);
    return press(found);
  }
  if (what === 'wheel') {
    // The board's own canvas and not just the first one on the page: a split board draws the region beside the sphere,
    // and a wheel over the wrong canvas zooms the wrong picture.
    const at = (await centre('[data-region=eve-space] canvas')) ?? (await centre('canvas'));
    if (!at) return console.warn('demo: no board canvas');
    for (let i = 0; i < (b ?? 1); i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: a });
      await sleep(430);
    }
    return;
  }
  if (what === 'drag') {
    const at = await centre('svg[data-region=sphere-minimap]');
    if (!at) return console.warn('demo: no minimap');
    const steps = 20;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= steps; i += 1) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(at.x + (a * i) / steps),
        y: Math.round(at.y + (b * i) / steps),
        button: 'left',
        buttons: 1,
      });
      await sleep(45);
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: Math.round(at.x + a),
      y: Math.round(at.y + b),
      button: 'left',
      clickCount: 1,
    });
    return;
  }
  throw new Error(`demo: unknown action ${what}`);
}

async function main() {
  const browser = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    'about:blank',
  ]);
  try {
    await sleep(1500);
    const { send, seen } = await cdp();
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.enable');
    await send('Page.navigate', { url: script.url });
    await sleep(10000);

    const start = Date.now();
    const clock = () => (Date.now() - start) / 1000;
    await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });

    const captions = [];
    if (!voices) console.warn('demo: no voice times, so every scene holds for its own wait alone');
    for (const [index, scene] of script.scenes.entries()) {
      const from = clock();
      for (const action of scene.actions) await act(send, action);
      // A scene with a line holds until that line has been spoken, so a caption never changes under a sentence.
      // The line's length is in seconds and the sleeper takes milliseconds.
      const spoken = (scene.say ? (voices?.lines?.[index]?.length ?? 0) : 0) * 1000;
      if (spoken > 0) await sleep(Math.max(0, spoken + 600 - (clock() - from) * 1000));
      captions.push({ text: scene.caption ?? null, from, to: clock() });
    }
    await send('Page.stopScreencast');
    const end = clock();

    // Where each scene began, so a dub can be cut to the picture rather than to a second count kept by hand.
    writeFileSync(
      join(ROOT, '.demo', 'demo-times.json'),
      `${JSON.stringify({ seconds: end, scenes: captions.map((caption, index) => ({ text: caption.text, from: caption.from, to: captions[index + 1]?.from ?? end })) }, null, 2)}\n`,
    );

    // A caption holds from its own scene until the next one begins, so nothing is unlabelled while the page moves.
    // A storyboard may leave the caption out, which is a demo that carries no text at all.
    const windows = captions
      .map((caption, index) => ({
        text: caption.text,
        from: Math.max(caption.from + 0.1, 0.15),
        to: (captions[index + 1]?.from ?? end) - 0.15,
      }))
      .filter((window) => window.text);

    mkdirSync(dirname(join(ROOT, script.out)), { recursive: true });
    writeFileSync(join(frames, 'list.txt'), concatOf(seen));
    for (const [index, window] of windows.entries()) {
      const at = join(frames, `cap${index + 1}.png`);
      const made = spawnSync('magick', [
        '-background', 'rgba(10,12,16,0.78)',
        '-fill', '#e9eff8',
        '-font', FONT,
        '-pointsize', '38',
        '-gravity', 'center',
        `label:${window.text}`,
        '-bordercolor', 'none',
        '-border', '26x16',
        at,
      ]);
      if (made.status !== 0) throw new Error('magick could not render a caption');
    }
    // A storyboard with no captions is encoded as it was captured, with no overlay graph at all.
    const overlay = windows.length
      ? ['-filter_complex', overlayOf(windows), '-map', `[v${windows.length}]`]
      : [];
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', join(frames, 'list.txt'),
      ...windows.flatMap((_, index) => ['-i', join(frames, `cap${index + 1}.png`)]),
      ...overlay,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '20',
      '-r', '30',
      '-movflags', '+faststart',
      join(ROOT, script.out),
    ], { stdio: ['ignore', 'ignore', 'inherit'] });

    console.log(`demo: ${script.out}, ${seen.length} frames, ${end.toFixed(2)}s, ${windows.length} captions`);
  } finally {
    browser.kill();
    // Best effort: Chrome may still be writing the profile, and a temp directory is the system's to reclaim.
    for (const path of [profile, frames]) {
      try {
        rmSync(path, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
      } catch {
        // Left for the temp cleaner rather than failing a recording that is already written.
      }
    }
  }
}

/** Each frame held for the time the page stood on it, which is what keeps the motion the page's own. */
function concatOf(seen) {
  const lines = [];
  for (const [index, frame] of seen.entries()) {
    const next = seen[index + 1];
    const held = Math.min(Math.max((next ? next.at : frame.at + 0.6) - frame.at, 0.004), 0.5);
    lines.push(`file '${frame.name}'`, `duration ${held.toFixed(4)}`);
  }
  lines.push(`file '${seen[seen.length - 1].name}'`);
  return `${lines.join('\n')}\n`;
}

/** The captions as overlays that are enabled only inside their own window. */
function overlayOf(windows) {
  let chain = '';
  let last = '0:v';
  for (const [index, window] of windows.entries()) {
    const out = `v${index + 1}`;
    chain +=
      `[${last}][${index + 1}:v]overlay=x=(W-w)/2:y=H-h-44` +
      `:enable='between(t,${window.from.toFixed(2)},${window.to.toFixed(2)})'[${out}];`;
    last = out;
  }
  return chain.replace(/;$/, '');
}

await main();
