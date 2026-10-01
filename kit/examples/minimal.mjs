// The smallest complete demo: a title card and one recorded, narrated scene. Also the kit's CI check.
import { createStudio, sleep, tap } from '../studio.mjs';

const studio = await createStudio({ title: process.env.DEMO_TITLE ?? 'Minimal Demo' });
try {
  studio.narrate({
    title: 'This is Demo Studio.',
    click: 'Every scene is recorded from the real app, and each click is paced to what the narrator is saying.',
  });
  const chime = studio.sound('chime');

  await studio.composeCard('title', `
    <div class="abs" style="inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
      ${studio.MARK(120)}<h1 style="font-size:120px">Demo Studio</h1>
    </div>`, 'title', 1.5);

  const page = await studio.newPage({ width: 1600, height: 900 });
  await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;font:600 48px system-ui;background:#f4f6f8">
    <button style="font:inherit;padding:24px 48px;border-radius:16px" onclick="this.textContent = 'Done!'">Click me</button></body>`);
  const scene = await studio.record('click', [{ page, key: 'main', width: 1600, height: 900 }], async ({ say, sfx, until }) => {
    await sleep(600);
    const done = say('click');
    await sleep(1500);
    await tap(page, page.getByRole('button'), 900);
    sfx(chime);
    await until(done + 1.2);
  });
  await studio.composeFramed(scene, 'A recorded scene', 'Framed under a heading, with a pointer and click ripples');

  studio.finish({ output: process.env.OUTPUT });
} finally {
  await studio.close();
}
