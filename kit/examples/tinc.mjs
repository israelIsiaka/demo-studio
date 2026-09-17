// Worked example: the TInC Virtual Quiz demo (a live school quiz app: public site, phones, admin, control room,
// presentation board). Seeds a throwaway database, starts the real server, records seven scenes and two cards.
// Needs the app checked out at ~/tinc-virtual-quiz and `npm install --no-save mongodb-memory-server` in kit/.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createStudio, glide, log, pointTo, run, sleep, tap, type } from '../studio.mjs';

const REPO = process.env.TINC_REPO ?? join(homedir(), 'tinc-virtual-quiz');
const SERVER = join(REPO, 'server');
const { io } = createRequire(join(REPO, 'client', 'package.json'))('socket.io-client');
const PORT = 4470;
const APP = `http://localhost:${PORT}`;

// ---------------------------------------------------------------- narration

const SCRIPT = {
  title: 'Meet TInC Virtual Quiz: a live science competition for secondary schools, run entirely online.',
  public: 'Everything starts on the public site, with the current competition, its subjects and format, the round schedule, and the partners behind it.',
  register: 'Students register from their phones in under a minute. Their dashboard shows the entry is waiting for review.',
  admin: 'Organisers run the competition from the admin dashboard. They approve contestants, keep a reviewed question bank, and build each round: who takes part, which questions, and in what order.',
  ready: 'When the round begins, contestants join the Google Meet and step into the quiz arena.',
  live1: 'The Quiz Master launches a question. It appears on every phone and on the presentation board at the same moment, with a timer controlled by the server.',
  live2: 'Answers stream in live. The control room shows who is connected and how the room is answering, while the answer key stays with the officials.',
  live3: 'Then, the reveal. Everyone sees the correct answer together, and scores update instantly.',
  board: 'The media officer shares the presentation board into the Meet, with live statistics, the leaderboard, and the final results.',
  results: 'Once the organisers publish, results appear on the public site for every school to see.',
  outro: 'TInC Virtual Quiz. One connected platform, from registration to results.',
};

const studio = await createStudio({
  title: 'TInC Virtual Quiz',
  brand: {
    colors: { bg: '#001024', glow: '#01274a', text: '#f8fafd', muted: '#ced9e5', link: '#9bc9fa', brand: '#2c7cc8', accent: '#fbce5c', line: '#273442' },
    mark: (size) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2c7cc8"/><rect x="14" y="14" width="36" height="9" rx="2.5" fill="#fff"/><rect x="27.5" y="14" width="9" height="36" rx="2.5" fill="#fff"/><circle cx="47" cy="46" r="6" fill="#fbce5c"/></svg>`,
  },
});
const { C, MARK } = studio;
studio.narrate(SCRIPT);
const chime = studio.sound('chime');
const fanfare = studio.sound('fanfare');

// ---------------------------------------------------------------- data and server

const mongo = await MongoMemoryServer.create();
const env = { ...process.env, MONGODB_URI: mongo.getUri('tinc'), JWT_SECRET: 'demo-video', PORT: String(PORT), CLIENT_ORIGIN: APP, NODE_ENV: 'production' };
run('node', ['src/seed.js'], { cwd: SERVER, env });

const importServer = async (file) => (await import(pathToFileURL(join(SERVER, file)).href)).default;
const mongoose = await importServer('node_modules/mongoose/index.js');
const [Competition, Contestant, Question, School, Session] = await Promise.all(['Competition', 'Contestant', 'Question', 'School', 'Session'].map((m) => importServer(`src/models/${m}.js`)));
const { hashPassword } = await import(pathToFileURL(join(SERVER, 'src/password.js')).href);
await mongoose.connect(mongo.getUri('tinc'));

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology'];
const competition = await Competition.findOne({ title: '2026 Virtual Inter-Science Quiz' });
const schools = [];
for (const name of ['Greenfield College', 'Riverside Academy', 'Unity Model College', 'Harmony High School', 'Crestview Secondary School', 'Sunrise International School']) {
  schools.push(await School.named(name));
}
const studentHash = await hashPassword('student-password');
const slug = (name) => name.toLowerCase().replace(/[^a-z]+/g, '.');
const NAMES = ['Tunde Bakare', 'Zainab Musa', 'Chidi Eze', 'Ifeoma Nwosu', 'Yusuf Bello', 'Amaka Obi', 'Segun Adeyemi', 'Halima Sani', 'Emeka Nnadi', 'Funmi Ojo', 'Ibrahim Lawal', 'Ngozi Ike', 'David Etim', 'Blessing Akpan', 'Kelechi Uche', 'Aisha Garba', 'Tobi Afolabi', 'Precious Edet', 'Samuel Oni', 'Grace Okon'];
const students = await Contestant.insertMany(
  NAMES.map((fullName, i) => ({ fullName, email: `${slug(fullName)}@students.test`, passwordHash: studentHash, school: schools[i % schools.length]._id, subjects: SUBJECTS, status: 'approved', competitions: [competition._id] }))
);
await Contestant.create({ fullName: 'Musa Danjuma', email: 'musa.danjuma@students.test', passwordHash: studentHash, school: schools[2]._id, subjects: SUBJECTS, status: 'pending', competitions: [competition._id] });

const joules = await Question.findOne({ text: /measured in joules/ });
await Question.updateOne({ _id: joules._id }, { timeLimitSeconds: 45 });
const [algebra, ph] = await Question.create([
  { competition: competition._id, subject: 'Mathematics', text: 'If 3x + 7 = 22, what is the value of x?', options: ['15', '3', '5', '7'], correctOptionIndex: 2, explanation: '3x = 22 − 7 = 15, so x = 15 ÷ 3 = 5.', timeLimitSeconds: 45, status: 'approved' },
  { competition: competition._id, subject: 'Chemistry', text: 'What is the pH of pure water at 25 °C?', options: ['7', '0', '14', '10'], correctOptionIndex: 0, explanation: 'Pure water is neutral: hydrogen and hydroxide ions balance at pH 7.', timeLimitSeconds: 45, points: 2, status: 'approved' },
]);
await Question.create({ competition: competition._id, subject: 'Biology', text: 'Which blood cells help the body fight infection?', options: ['Red blood cells', 'White blood cells', 'Platelets', 'Plasma'], correctOptionIndex: 1, explanation: 'White blood cells find and destroy germs.', status: 'approved' });
const QUESTIONS = [joules, algebra, ph].map((q) => ({ id: q.id, correct: q.correctOptionIndex, options: q.options.length }));
const grandFinal = await Session.create({
  competition: competition._id,
  roundName: 'Grand Final',
  scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
  meetingLink: 'https://meet.google.com/',
  contestants: students.map((s) => s._id),
  questions: [joules._id, algebra._id, ph._id],
  status: 'ready',
});
const sessionId = grandFinal.id;
await mongoose.disconnect();

const server = spawn('node', ['src/index.js'], { cwd: SERVER, env, stdio: ['ignore', 'ignore', 'pipe'] });
let serverErrors = '';
server.stderr.on('data', (d) => (serverErrors += d));
for (let i = 0; i < 100 && !(await fetch(`${APP}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(100);
const apiLogin = async (email, password) =>
  (await (await fetch(`${APP}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).token;

// App-specific page helpers: sign in through the real form, and wait for loading text to clear.
async function newPage({ width, height, arrow, credentials }) {
  const page = await studio.newPage({ width, height, arrow });
  if (credentials) {
    await page.goto(`${APP}/login`);
    await page.getByLabel('Email').fill(credentials[0]);
    await page.getByLabel('Password').fill(credentials[1]);
    await page.getByRole('button', { name: /log ?in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  }
  return page;
}
const settle = (page) => page.waitForFunction(() => !/Loading…|Connecting…/.test(document.body.innerText), null, { timeout: 15_000 });

// ---------------------------------------------------------------- the film

const sockets = [];
try {
  // Title
  await studio.composeCard('title', `
    <div class="abs" style="inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
      ${MARK(132)}
      <div style="margin-top:40px;font-size:168px;font-weight:900;line-height:.9;letter-spacing:-.02em">TInC</div>
      <div style="margin-top:22px;font-size:36px;font-weight:700;letter-spacing:.42em;padding-left:.42em;color:${C.link}">VIRTUAL QUIZ</div>
      <div style="margin-top:56px;font-size:42px;color:${C.muted}">Think. Challenge. Excel.</div>
    </div>`, 'title');

  // 1. Public site
  const visitor = await newPage({ width: 1600, height: 900 });
  await visitor.goto(APP);
  await settle(visitor);
  await visitor.mouse.move(800, 450);
  const publicScene = await studio.record('public', [{ page: visitor, key: 'main', width: 1600, height: 900 }], async ({ say, until }) => {
    await sleep(700);
    const done = say('public');
    await sleep(1800);
    await pointTo(visitor, visitor.getByRole('link', { name: 'Register Now' }), 900);
    await sleep(600);
    await glide(visitor, 'bottom', (done - 3.2) * 1000);
    await until(done + 1.4);
  });
  await studio.composeFramed(publicScene, 'The public site', 'Competition details, schedule, rules and results');

  // 2. Registration on a phone
  const adaeze = await newPage({ width: 430, height: 932, arrow: false });
  await adaeze.goto(`${APP}/register`);
  await settle(adaeze);
  const registerScene = await studio.record('register', [{ page: adaeze, key: 'phone', width: 430, height: 932 }], async ({ say, until }) => {
    await sleep(600);
    const done = say('register');
    await type(adaeze, adaeze.getByLabel('Full name'), 'Adaeze Okafor');
    await type(adaeze, adaeze.getByLabel('Email'), 'adaeze.okafor@students.test', 32);
    await type(adaeze, adaeze.getByLabel('Password'), 'greenfield26', 45);
    await type(adaeze, adaeze.getByLabel('School'), 'Greenfield College', 40);
    for (const subject of ['Mathematics', 'Physics', 'Chemistry']) await tap(adaeze, adaeze.getByLabel(subject), 380);
    await tap(adaeze, adaeze.getByRole('button', { name: 'Register' }));
    await adaeze.getByText('My Dashboard').waitFor();
    await glide(adaeze, 0, 400);
    await until(Math.max(done + 1.2, 0));
    await sleep(1800);
  });
  await studio.composePhone(registerScene, 'Register in a minute', 'Students sign up from any phone and follow their entry from their dashboard.');

  // 3. Admin dashboard
  const admin = await newPage({ width: 1600, height: 900, credentials: ['admin@tinc.test', 'admin-password'] });
  await settle(admin);
  await admin.mouse.move(800, 450);
  const adminScene = await studio.record('admin', [{ page: admin, key: 'main', width: 1600, height: 900 }], async ({ say, until }) => {
    await sleep(700);
    const done = say('admin');
    await sleep(1500);
    await tap(admin, admin.getByRole('link', { name: 'Contestants', exact: true }));
    await admin.getByText('Adaeze Okafor').first().waitFor();
    await sleep(900);
    await tap(admin, admin.getByRole('row', { name: /Adaeze Okafor/ }).getByRole('button', { name: 'Approve' }));
    await admin.getByRole('row', { name: /Adaeze Okafor/ }).getByText('Approved').waitFor();
    await sleep(1100);
    await tap(admin, admin.getByRole('link', { name: 'Question Bank', exact: true }));
    await settle(admin);
    await sleep(700);
    await glide(admin, 380, 1300);
    await sleep(700);
    await tap(admin, admin.getByRole('link', { name: 'Rounds & Sessions', exact: true }));
    await settle(admin);
    await sleep(600);
    await tap(admin, admin.getByRole('row', { name: /Grand Final/ }).getByRole('button', { name: 'Edit' }));
    const adaezeBox = admin.getByRole('checkbox', { name: /Adaeze Okafor/ });
    await adaezeBox.waitFor();
    await glide(admin, adaezeBox, 1100);
    await sleep(400);
    await tap(admin, adaezeBox);
    await sleep(500);
    await glide(admin, admin.getByText('Questions, in order'), 1100);
    await sleep(1400);
    await tap(admin, admin.getByRole('button', { name: 'Save', exact: true }));
    await admin.getByRole('button', { name: 'New session' }).waitFor();
    await glide(admin, 0, 700);
    await until(done + 1.5);
  });
  await studio.composeFramed(adminScene, 'The admin dashboard', 'Approve contestants, review questions, build each round');

  // 4. Contestant enters the arena
  await adaeze.goto(`${APP}/contestant/dashboard`);
  await settle(adaeze);
  const readyScene = await studio.record('ready', [{ page: adaeze, key: 'phone', width: 430, height: 932 }], async ({ say, until }) => {
    await sleep(600);
    const done = say('ready');
    await sleep(2200);
    await tap(adaeze, adaeze.getByRole('link', { name: 'Enter Quiz Arena' }));
    await adaeze.getByText('Waiting for the Quiz Master').waitFor();
    await until(done + 1.6);
  });
  await studio.composePhone(readyScene, 'Join the round', 'Google Meet for the call, the quiz arena for answers.');

  // Everyone else takes their seats.
  const tunde = await newPage({ width: 430, height: 932, arrow: false, credentials: ['tunde.bakare@students.test', 'student-password'] });
  await tunde.goto(`${APP}/contestant/quiz/${sessionId}`);
  await tunde.getByText('Waiting for the Quiz Master').waitFor();
  const qm = await newPage({ width: 1024, height: 576, credentials: ['quizmaster@tinc.test', 'quizmaster-password'] });
  await qm.goto(`${APP}/quizmaster/${sessionId}`);
  await settle(qm);
  const board = await newPage({ width: 1280, height: 720, credentials: ['media@tinc.test', 'media-password'] });
  await board.goto(`${APP}/media/${sessionId}`);
  await settle(board);
  await board.getByRole('button', { name: 'Enable sound' }).click();
  await board.mouse.move(1279, 719);

  const socketFor = async (email, password, audience) => {
    const socket = io(APP, { auth: { token: await apiLogin(email, password) }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise((resolve, reject) => socket.on('connect', resolve).on('connect_error', reject));
    socket.send2 = (event, payload = {}) => new Promise((resolve) => socket.timeout(8000).emit(event, { sessionId, ...payload }, (err, res) => resolve(err ? { error: 'timeout' } : res)));
    await socket.send2('session:join', { audience });
    return socket;
  };
  const sims = [];
  for (const s of students.slice(1)) sims.push({ name: s.fullName, socket: await socketFor(s.email, 'student-password', 'contestant') });
  const qmSocket = await socketFor('quizmaster@tinc.test', 'quizmaster-password', 'control');
  const mediaSocket = await socketFor('media@tinc.test', 'media-password', 'media');
  await qm.getByText('21 / 21').first().waitFor({ timeout: 15_000 }).catch(() => log('note: connected count not shown as 21 / 21'));

  // Who answers what: Adaeze wins outright, Chidi is second, Zainab third, the room is realistic.
  const pick = (q, correct) => (correct ? QUESTIONS[q].correct : [...Array(QUESTIONS[q].options).keys()].filter((i) => i !== QUESTIONS[q].correct)[Math.floor(Math.random() * (QUESTIONS[q].options - 1))]);
  const plan = sims.map((sim, i) => {
    if (sim.name === 'Chidi Eze') return [true, false, true];
    if (sim.name === 'Zainab Musa') return [true, true, false];
    return i % 5 < 3 ? [true, false, false] : i % 5 === 3 ? [false, true, false] : [false, false, false];
  });
  const simsAnswer = (q, from, spread) =>
    Promise.all(sims.map((sim, i) => sleep(from + Math.random() * spread).then(() => sim.socket.send2('answer:submit', { questionId: QUESTIONS[q].id, optionIndex: pick(q, plan[i][q]) }))));
  const phoneAnswer = async (page, index, animate) => {
    const option = page.locator('label.option').nth(index);
    if (animate) {
      await tap(page, option, 500);
      await tap(page, page.getByRole('button', { name: 'Submit Answer' }), 500);
    } else {
      await option.click();
      await page.getByRole('button', { name: 'Submit Answer' }).click();
    }
    await page.getByText('Answer submitted').waitFor();
  };

  // 5. The live round, all at once
  const liveScene = await studio.record('live', [
    { page: qm, key: 'top', width: 1024, height: 576 },
    { page: board, key: 'bottom', width: 1280, height: 720 },
    { page: adaeze, key: 'phoneA', width: 430, height: 932 },
    { page: tunde, key: 'phoneB', width: 430, height: 932 },
  ], async ({ say, sfx, until, at }) => {
    await sleep(600);
    const first = say('live1');
    await sleep(1400);
    await tap(qm, qm.getByRole('button', { name: 'Launch first question' }), 700);
    const launched = at();
    await adaeze.getByText('Question 1 of 3').waitFor();
    const answers = simsAnswer(0, 1500, 10500);
    await until(launched + 3.2);
    await phoneAnswer(adaeze, QUESTIONS[0].correct, true);
    await until(Math.max(first + 0.5, launched + 6.5));
    const second = say('live2');
    await phoneAnswer(tunde, 0, true);
    await glide(qm, qm.getByRole('heading', { name: 'Answer Monitoring' }), 1300);
    await answers;
    await until(second + 0.2);
    await glide(qm, 0, 1000);
    await tap(qm, qm.getByRole('button', { name: 'Reveal Answer' }), 700);
    sfx(chime, 0.15);
    await sleep(900);
    const third = say('live3');
    await adaeze.getByText('You got it right!').waitFor();
    await until(third + 2.4);
  });
  await studio.composeSplit(liveScene, {
    top: ['Quiz Master', 'control room'],
    bottom: ['Presentation board', 'shared in Google Meet'],
    phones: ['Contestants', 'on their phones'],
    note: 'Server-controlled timer · live answer counts · answer key for officials only',
  });

  // Questions 2 and 3 run between scenes.
  for (const q of [1, 2]) {
    const launch = await qmSocket.send2('question:launch', { expectedIndex: q - 1 });
    if (launch.error) throw new Error(`launch ${q + 1}: ${launch.error}`);
    await adaeze.getByText(`Question ${q + 1} of 3`).waitFor();
    await tunde.getByText(`Question ${q + 1} of 3`).waitFor();
    await Promise.all([simsAnswer(q, 200, 1500), phoneAnswer(adaeze, QUESTIONS[q].correct, false), phoneAnswer(tunde, q === 1 ? QUESTIONS[q].correct : pick(q, false), false)]);
    await sleep(500);
    await qmSocket.send2('answer:reveal');
    await qmSocket.send2('scores:finalize');
    await sleep(600);
  }
  await mediaSocket.send2('media:screen', { screen: 'statistics' });
  await board.setViewportSize({ width: 1600, height: 900 });
  await board.getByText(/CORRECT ·/).waitFor();
  await sleep(800);

  // 6. The presentation board
  const boardScene = await studio.record('board', [{ page: board, key: 'main', width: 1600, height: 900 }], async ({ say, sfx, until }) => {
    await sleep(600);
    const done = say('board');
    await sleep(3200);
    await mediaSocket.send2('media:screen', { screen: 'leaderboard' });
    await board.getByText('Adaeze Okafor').first().waitFor();
    await until(Math.max(done - 1.2, 7.5));
    await mediaSocket.send2('media:screen', { screen: 'final' });
    sfx(fanfare, 0.1);
    await board.getByText('1ST PLACE').waitFor();
    await until(Math.max(done + 3.2, 12));
  });
  await studio.composeFramed(boardScene, 'The presentation board', 'Shared into Google Meet by the media officer');

  // 7. Results on the public site
  await qmSocket.send2('round:end');
  const adminToken = await admin.evaluate(() => JSON.parse(localStorage.getItem('tinc_auth')).token);
  const published = await fetch(`${APP}/api/admin/sessions/${sessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ resultsPublished: true }) });
  if (!published.ok) throw new Error(`publish results: ${published.status}`);
  const reader = await newPage({ width: 430, height: 932, arrow: false });
  await reader.goto(`${APP}/results`);
  await settle(reader);
  await reader.getByText('Adaeze Okafor').first().waitFor();
  const resultsScene = await studio.record('results', [{ page: reader, key: 'phone', width: 430, height: 932 }], async ({ say, until }) => {
    await sleep(600);
    const done = say('results');
    await sleep(1600);
    await glide(reader, reader.getByText('Adaeze Okafor').first(), 2200);
    await until(done + 1.8);
  });
  await studio.composePhone(resultsScene, 'Published results', 'Every school sees the leaderboard on the public site.');

  // Outro
  const pillars = ['Public site', 'Contestant portal', 'Admin dashboard', 'Quiz Master control room', 'Presentation board'];
  await studio.composeCard('outro', `
    <div class="abs" style="inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:36px">
      ${MARK(104)}
      <h1 style="font-size:92px">One connected platform</h1>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:16px;max-width:1500px">
        ${pillars.map((p) => `<span style="font-size:30px;padding:14px 26px;border-radius:999px;border:2px solid ${C.brand};color:${C.text};background:#0d1f35">${p}</span>`).join('')}
      </div>
      <p style="font-size:40px;color:${C.muted}">From registration to results.</p>
    </div>`, 'outro', 3.4);

  server.kill();
  studio.finish();
} finally {
  for (const s of sockets) s.close();
  await studio.close();
  server.kill();
  await mongo.stop();
  if (serverErrors.trim()) log('server stderr:', serverErrors.slice(-1500));
}
