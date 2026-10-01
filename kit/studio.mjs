// Demo Studio recording kit. Drives the real app in headless browsers, paces every scene to its narration,
// lays scenes out on branded frames, and saves a demo package that Demo Studio narrates and mixes into an MP4.
// See examples/minimal.mjs for a complete demo built with it.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const FFMPEG = createRequire(import.meta.url)('ffmpeg-static');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOUND = fileURLToPath(new URL('./sound.mjs', import.meta.url));
const FPS = 30;
export const HOME = process.env.DEMO_STUDIO_HOME ?? join(homedir(), 'Demo Studio');
export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed:\n${(r.stderr || '').slice(-3000)}`);
  return r;
}
const ffmpeg = (args) => run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
// Demo Studio's voice and mixing side, from this same repo.
const studioCli = (args, options = {}) => run('uv', ['run', '--quiet', '--project', ROOT, 'demo-studio', ...args], { stdio: ['pipe', 'pipe', 'inherit'], ...options });

// ---------------------------------------------------------------- pointer and scrolling

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

// Smooth scroll the window to a y position, 'bottom', or an element (centred).
export async function glide(page, target, ms = 1200) {
  const y = typeof target === 'object' ? await target.evaluate((el) => el.getBoundingClientRect().top + scrollY - innerHeight / 2 + el.offsetHeight / 2) : target;
  await page.evaluate(
    ([to, duration]) =>
      new Promise((resolve) => {
        const from = scrollY;
        const end = to === 'bottom' ? document.documentElement.scrollHeight - innerHeight : Math.max(0, Math.min(to, document.documentElement.scrollHeight - innerHeight));
        const start = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - start) / duration);
          scrollTo(0, from + (end - from) * (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2));
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [y, ms]
  );
}

export async function pointTo(page, locator, ms = 650) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || box.y < 70 || box.y + box.height > viewport.height - 40) {
    await glide(page, locator, 700);
  }
  const b = await locator.boundingBox();
  const to = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const from = page.pos;
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const p = ease(i / steps);
    await page.mouse.move(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p);
    await sleep(ms / steps);
  }
  page.pos = to;
}

export async function tap(page, locator, ms) {
  await pointTo(page, locator, ms);
  await sleep(120);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(250);
}

export async function type(page, locator, text, delay = 55) {
  await tap(page, locator, 450);
  await page.keyboard.type(text, { delay });
  await sleep(200);
}

// Headless browsers draw no pointer: an arrow for desktop views, a tap ripple for phones.
const pointerScript = (arrow) => `
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '@keyframes __tap{from{transform:scale(.35);opacity:.95}to{transform:scale(1.5);opacity:0}}';
    document.documentElement.append(style);
    ${arrow ? `
    const cursor = document.createElement('div');
    cursor.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-99px,-99px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))';
    cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2.5l7 18.5 2.7-7.3 7.3-2.7z" fill="#fff" stroke="#08121e" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.append(cursor);
    addEventListener('mousemove', (e) => (cursor.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 3) + 'px)'), true);` : ''}
    addEventListener('mousedown', (e) => {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;border-radius:50%;background:rgba(155,201,250,.28);border:2px solid #9bc9fa;left:' + (e.clientX - 22) + 'px;top:' + (e.clientY - 22) + 'px;animation:__tap .55s ease-out forwards';
      document.documentElement.append(ring);
      setTimeout(() => ring.remove(), 650);
    }, true);
  });`;

// ---------------------------------------------------------------- the studio

const DEFAULT_COLORS = { bg: '#0b1220', glow: '#1b2a4a', text: '#f8fafd', muted: '#c9d3de', link: '#9bc9fa', brand: '#2c7cc8', accent: '#fbce5c', line: '#273442' };

/**
 * title: the video's name. brand: { colors: partial DEFAULT_COLORS, mark: (size) => '<svg ...>' }.
 * Package goes to "<Demo Studio>/demos/<title>", where the Demo Studio app lists it.
 */
export async function createStudio({ title, brand = {} }) {
  const C = { ...DEFAULT_COLORS, ...brand.colors };
  const MARK = brand.mark ?? ((size) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${C.brand}"/><circle cx="32" cy="32" r="12" fill="#fff"/></svg>`);
  const out = join(HOME, 'demos', title.replace(/[<>:"/\\|?*.]/g, '').trim());
  const work = mkdtempSync(join(tmpdir(), 'demo-studio-'));
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const segments = [];
  let lines = {};
  let voice = {};

  // Voices every line (the owner's recorded voice, or the built-in one) and returns { key: { file, seconds } }.
  function narrate(script) {
    lines = script;
    voice = JSON.parse(studioCli(['speak'], { input: JSON.stringify(script) }).stdout);
    log('narration ready', Object.fromEntries(Object.entries(voice).map(([k, v]) => [k, v.seconds.toFixed(1)])));
    return voice;
  }

  // 'chime' or 'fanfare', saved into the package; pass the result to sfx() inside a scene.
  function sound(name) {
    run(process.execPath, [SOUND, name, join(out, `${name}.wav`)]);
    return `${name}.wav`;
  }

  async function newPage({ width, height, arrow = true }) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript({ content: pointerScript(arrow) });
    const page = await context.newPage();
    page.on('pageerror', (e) => log('page error:', e.message));
    page.pos = { x: width / 2, y: height / 2 };
    return page;
  }

  // ---------------------------------------------------------------- recording

  // Streams a page's screencast into ffmpeg at a constant 30 fps (repeating the latest frame).
  async function startRecorder(page, file, width, height) {
    const cdp = await page.context().newCDPSession(page);
    let frame = null;
    cdp.on('Page.screencastFrame', ({ data, sessionId: id }) => {
      frame = Buffer.from(data, 'base64');
      cdp.send('Page.screencastFrameAck', { sessionId: id }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height });
    while (!frame) await sleep(10);
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-', '-vf', `scale=${width}:${height}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', file], { stdio: ['pipe', 'ignore', 'inherit'] });
    let written = 0;
    let t0;
    let timer;
    const pump = (now) => {
      const due = Math.floor(((now - t0) / 1000) * FPS);
      while (written < due) {
        ff.stdin.write(frame);
        written++;
      }
    };
    return {
      begin(at) {
        t0 = at;
        timer = setInterval(() => pump(performance.now()), 8);
      },
      async end(at) {
        clearInterval(timer);
        pump(at);
        ff.stdin.end();
        await once(ff, 'close');
        await cdp.send('Page.stopScreencast').catch(() => {});
        await cdp.detach().catch(() => {});
        return written / FPS;
      },
    };
  }

  /**
   * Records one scene from one or more pages. tracks: [{ page, key, width, height }].
   * script({ say, sfx, until, at }): say(key) starts that line and returns the time it ends;
   * until(t) waits until t seconds into the scene; sfx(sound(...), delay) plays an effect.
   */
  async function record(name, tracks, script) {
    log('recording', name);
    const recorders = await Promise.all(tracks.map((t) => startRecorder(t.page, join(work, `${name}-${t.key}.mp4`), t.width, t.height)));
    const t0 = performance.now();
    for (const r of recorders) r.begin(t0);
    const cues = [];
    const at = () => (performance.now() - t0) / 1000;
    const until = (seconds) => sleep((seconds - at()) * 1000);
    const say = (key) => {
      cues.push({ voice: key, at: at(), seconds: voice[key].seconds });
      return at() + voice[key].seconds;
    };
    const sfx = (file, delay = 0) => cues.push({ sound: file, at: at() + delay });
    await script({ at, until, say, sfx });
    const end = performance.now();
    const durations = await Promise.all(recorders.map((r) => r.end(end)));
    const seconds = Math.min(...durations);
    log(`  ${name}: ${seconds.toFixed(1)}s`);
    return { name, seconds, cues, tracks: Object.fromEntries(tracks.map((t) => [t.key, join(work, `${name}-${t.key}.mp4`)])) };
  }

  // ---------------------------------------------------------------- layouts (HTML rendered to PNG)

  const htmlPage = (body, transparent = false) => `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: ${C.text};
      background: ${transparent ? 'transparent' : `radial-gradient(ellipse 120% 80% at 50% -10%, ${C.glow}, ${C.bg} 70%)`}; }
    .abs { position: absolute; }
    .label { font-size: 22px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: ${C.link}; }
    .label span { color: ${C.muted}; font-weight: 500; }
    h1 { margin: 0; font-weight: 800; letter-spacing: -0.01em; line-height: 1.05; }
    p { margin: 0; }
  </style></head><body>${body}</body></html>`;

  const renderer = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  async function renderPng(html, file, transparent = false) {
    await renderer.setContent(htmlPage(html, transparent));
    await renderer.screenshot({ path: file, omitBackground: transparent });
    return file;
  }

  const FRAME = { x: 160, y: 150, w: 1600, h: 900 };
  const framedBackground = (heading, sub) => `
    <div class="abs" style="left:${FRAME.x}px;top:42px;display:flex;align-items:center;gap:22px">
      ${MARK(56)}
      <div><h1 style="font-size:44px">${heading}</h1><p style="font-size:24px;color:${C.muted};margin-top:6px">${sub}</p></div>
    </div>
    <div class="abs" style="left:${FRAME.x - 6}px;top:${FRAME.y - 6}px;width:${FRAME.w + 12}px;height:${FRAME.h + 12}px;border-radius:18px;background:#0d1824;border:2px solid ${C.line};box-shadow:0 30px 80px rgba(0,0,0,.5)"></div>`;

  const PHONE = { x: 1224, y: 76, w: 430, h: 932 };
  const phoneBackground = (heading, sub) => `
    <div class="abs" style="left:160px;top:0;height:1080px;width:900px;display:flex;flex-direction:column;justify-content:center;gap:26px">
      ${MARK(88)}
      <h1 style="font-size:84px">${heading}</h1>
      <p style="font-size:36px;line-height:1.35;color:${C.muted};max-width:820px">${sub}</p>
    </div>`;
  const bezel = (x, y, w, h, border = 16, radius = 60) =>
    `<div class="abs" style="left:${x - border}px;top:${y - border}px;width:${w + 2 * border}px;height:${h + 2 * border}px;border-radius:${radius}px;border:${border}px solid #03070d;box-shadow:0 0 0 2px #2b3a4b,0 40px 90px rgba(0,0,0,.55)"></div>`;

  const SPLIT = {
    top: { x: 50, y: 100, w: 800, h: 450 },
    bottom: { x: 50, y: 600, w: 800, h: 450 },
    phoneA: { x: 951, y: 100, w: 400, h: 867 },
    phoneB: { x: 1419, y: 100, w: 400, h: 867 },
  };
  const panelFrame = ({ x, y, w, h }) => `<div class="abs" style="left:${x - 5}px;top:${y - 5}px;width:${w + 10}px;height:${h + 10}px;border-radius:12px;background:#0d1824;border:2px solid ${C.line};box-shadow:0 20px 50px rgba(0,0,0,.45)"></div>`;
  const label = ([strong, rest]) => `${strong}${rest ? ` <span>· ${rest}</span>` : ''}`;
  const splitBackground = (labels) => `
    <div class="abs label" style="left:50px;top:56px">${label(labels.top)}</div>
    ${panelFrame(SPLIT.top)}
    <div class="abs label" style="left:50px;top:556px">${label(labels.bottom)}</div>
    ${panelFrame(SPLIT.bottom)}
    <div class="abs label" style="left:937px;top:40px">${label(labels.phones)}</div>
    <p class="abs" style="left:937px;top:1004px;font-size:22px;color:${C.muted}">${labels.note ?? ''}</p>`;
  const splitTop = () => bezel(SPLIT.phoneA.x, SPLIT.phoneA.y, SPLIT.phoneA.w, SPLIT.phoneA.h, 14, 54) + bezel(SPLIT.phoneB.x, SPLIT.phoneB.y, SPLIT.phoneB.w, SPLIT.phoneB.h, 14, 54);

  const fades = (d, f = 0.35) => `fade=t=in:st=0:d=${f},fade=t=out:st=${(d - f).toFixed(3)}:d=${f}`;
  const encode = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p'];
  const segment = (name) => join(work, `seg-${name}.mp4`);

  function finishScene(scene) {
    segments.push({ name: scene.name, seconds: scene.seconds, cues: scene.cues });
    for (const file of Object.values(scene.tracks)) rmSync(file, { force: true });
  }

  // A 1600x900 desktop recording (track key 'main') in a frame under a heading.
  async function composeFramed(scene, heading, sub) {
    const bg = await renderPng(framedBackground(heading, sub), join(work, `${scene.name}-bg.png`));
    const d = scene.seconds;
    ffmpeg(['-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', bg, '-i', scene.tracks.main,
      '-filter_complex', `[1:v]scale=${FRAME.w}:${FRAME.h}:flags=lanczos,setsar=1[v];[0:v][v]overlay=${FRAME.x}:${FRAME.y}:shortest=1,format=yuv420p,${fades(d)}[out]`,
      '-map', '[out]', '-t', String(d), ...encode, segment(scene.name)]);
    finishScene(scene);
  }

  // A 430x932 phone recording (track key 'phone') in a bezel beside a big heading.
  async function composePhone(scene, heading, sub) {
    const bg = await renderPng(phoneBackground(heading, sub), join(work, `${scene.name}-bg.png`));
    const top = await renderPng(bezel(PHONE.x, PHONE.y, PHONE.w, PHONE.h), join(work, `${scene.name}-top.png`), true);
    const d = scene.seconds;
    ffmpeg(['-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', bg, '-i', scene.tracks.phone, '-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', top,
      '-filter_complex', `[1:v]scale=${PHONE.w}:${PHONE.h}:flags=lanczos,setsar=1[p];[0:v][p]overlay=${PHONE.x}:${PHONE.y}:shortest=1[a];[a][2:v]overlay=0:0,format=yuv420p,${fades(d)}[out]`,
      '-map', '[out]', '-t', String(d), ...encode, segment(scene.name)]);
    finishScene(scene);
  }

  // Four views at once: two 16:9 panels on the left (keys 'top', 'bottom') and two phones (keys 'phoneA', 'phoneB').
  // labels: { top: ['Bold', 'rest'], bottom: [...], phones: [...], note: 'footer line' }.
  async function composeSplit(scene, labels) {
    const bg = await renderPng(splitBackground(labels), join(work, `${scene.name}-bg.png`));
    const top = await renderPng(splitTop(), join(work, `${scene.name}-top.png`), true);
    const d = scene.seconds;
    const { top: t, bottom: b, phoneA, phoneB } = SPLIT;
    ffmpeg(['-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', bg, '-i', scene.tracks.top, '-i', scene.tracks.bottom, '-i', scene.tracks.phoneA, '-i', scene.tracks.phoneB, '-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', top,
      '-filter_complex', [
        `[1:v]scale=${t.w}:${t.h}:flags=lanczos,setsar=1[c]`,
        `[2:v]scale=${b.w}:${b.h}:flags=lanczos,setsar=1[b]`,
        `[3:v]scale=${phoneA.w}:${phoneA.h}:flags=lanczos,setsar=1[pa]`,
        `[4:v]scale=${phoneB.w}:${phoneB.h}:flags=lanczos,setsar=1[pb]`,
        `[0:v][c]overlay=${t.x}:${t.y}:shortest=1[x1]`,
        `[x1][b]overlay=${b.x}:${b.y}[x2]`,
        `[x2][pa]overlay=${phoneA.x}:${phoneA.y}[x3]`,
        `[x3][pb]overlay=${phoneB.x}:${phoneB.y}[x4]`,
        `[x4][5:v]overlay=0:0,format=yuv420p,${fades(d)}[out]`,
      ].join(';'),
      '-map', '[out]', '-t', String(d), ...encode, segment(scene.name)]);
    finishScene(scene);
  }

  // A full-screen card (title, outro) with a slow zoom, held for its line plus `extra` seconds.
  async function composeCard(name, html, voiceKey, extra = 2.6) {
    const png = await renderPng(html, join(work, `${name}-card.png`));
    const d = 1 + voice[voiceKey].seconds + extra;
    const frames = Math.round(d * FPS);
    ffmpeg(['-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', png,
      '-vf', `scale=3840:-1,zoompan=z='1+0.05*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS},format=yuv420p,${fades(d, 0.7)}`,
      '-t', String(d), ...encode, segment(name)]);
    segments.push({ name, seconds: d, cues: [{ voice: voiceKey, at: 1, seconds: voice[voiceKey].seconds }] });
  }

  // ---------------------------------------------------------------- package and video

  // Joins the scenes, writes the package, and has Demo Studio narrate and mix it. Returns the MP4's path.
  function finish({ output } = {}) {
    let offset = 0;
    const cues = [];
    for (const seg of segments) {
      for (const cue of seg.cues) cues.push({ ...cue, at: offset + cue.at });
      offset += seg.seconds;
    }
    const list = join(work, 'segments.txt');
    writeFileSync(list, segments.map((s) => `file '${segment(s.name).replaceAll('\\', '/')}'`).join('\n'));
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(out, 'video.mp4')]);
    run(process.execPath, [SOUND, 'music', String(Math.ceil(offset + 1)), join(out, 'music.wav')]);
    writeFileSync(join(out, 'demo.json'), JSON.stringify({ title, duration: offset, lines, cues }, null, 2));
    log(`package saved: ${out} (${offset.toFixed(1)}s)`);
    const video = studioCli(['render', out, ...(output ? ['--out', output] : [])]).stdout.trim();
    log(`video: ${video}`);
    return video;
  }

  async function close() {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }

  return { C, MARK, out, browser, narrate, sound, newPage, record, composeFramed, composePhone, composeSplit, composeCard, finish, close };
}
