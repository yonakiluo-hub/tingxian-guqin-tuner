import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { TUNINGS, getStrings } from '../dist/tunings.js';
import { detectPitch, centsBetween, nearestString } from '../dist/pitch.js';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

// Isolated browser fixture: the production app and pitch detector run unchanged.
// Audio is deterministic PCM; these checks exercise resource cleanup and UI state,
// not real browser permission behavior or device microphone quality.
function setup({ permission, resume } = {}) {
  let now = 1000, nextTimer = 0, currentFrequency = getStrings()[0].frequency;
  let permissionCalls = 0, capturedConstraints;
  const timers = new Map(), elements = new Map(), contexts = [], tracks = [];
  class Target {
    constructor(id = '') {
      this.id = id; this.listeners = new Map(); this.style = {}; this.dataset = {};
      this.attributes = {}; this.textContent = ''; this.innerHTML = ''; this.hidden = false;
      const classes = new Set();
      this.classList = { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)),
        contains: v => classes.has(v), toggle: (v, on) => { if (on ?? !classes.has(v)) classes.add(v); else classes.delete(v); } };
    }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
    emit(name, event = {}) { return Promise.all((this.listeners.get(name) || []).map(fn => fn(event))); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    close() { this.open = false; }
    showModal() { this.open = true; }
  }
  const el = selector => { if (!elements.has(selector)) elements.set(selector, new Target(selector.replace(/^#/, ''))); return elements.get(selector); };
  const views = ['tuner','modes','guide'].map(v => el('#view-' + v));
  const navs = views.map((_, i) => { const n = new Target(); n.dataset.view = ['tuner','modes','guide'][i]; return n; });
  const document = new Target(); document.hidden = false;
  document.querySelector = el;
  document.querySelectorAll = selector => selector === '.view' ? views : selector === '.nav-item' || selector === '[data-view]' ? navs : selector === 'dialog' ? [el('#mode-dialog'),el('#settings-dialog')] : [];
  const location = { hash: '', hostname: 'appassets.androidplatform.net' };
  const window = new Target(); window.isSecureContext = true;
  window.history = { replaceState: (_a,_b,hash) => { location.hash = hash; } };
  window.matchMedia = () => ({ matches: false });
  class Context {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.currentTime = 0; this.destination = {}; this.links = []; contexts.push(this); }
    async resume() { if (resume) await resume.promise; if (this.state !== 'closed') this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect: target => this.links.push(target), disconnect() {} }; }
    createAnalyser() { return { fftSize: 0, disconnect() {}, getFloatTimeDomainData: array => {
      for (let i = 0; i < array.length; i++) array[i] = currentFrequency ? .3 * Math.sin(2 * Math.PI * currentFrequency * i / 48000) : 0;
    } }; }
    createGain() { return { connect() {}, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
  }
  window.AudioContext = Context;
  function createStream() {
    const track = new Target(); track.stopped = false; track.stop = () => { track.stopped = true; }; tracks.push(track);
    return { getTracks: () => [track] };
  }
  const navigator = { userAgent: 'Android test', mediaDevices: { getUserMedia: async constraints => {
    permissionCalls++; capturedConstraints = constraints;
    if (permission) return await permission.promise;
    return createStream();
  } } };
  const sandbox = vm.createContext({ window, document, navigator, location, performance: { now: () => now },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn, ms) => { const id=++nextTimer; timers.set(id,{fn,at:now+ms}); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => { const id=++nextTimer; timers.set(id,{fn,interval:ms}); return id; }, clearInterval: id => timers.delete(id),
    TUNINGS, getStrings, detectPitch, centsBetween, nearestString, console,
  });
  vm.runInContext(appSource.replace(/^import .*;\r?\n/gm, '') + '\n globalThis.app = {state,startListening,stopListening,playTone,stopTone,analyseFrame,selectString,selectTuning,showView};', sandbox);
  return { app: sandbox.app, el, window, document, contexts, tracks, createStream,
    get permissionCalls() { return permissionCalls; }, get constraints() { return capturedConstraints; },
    set frequency(value) { currentFrequency = value; },
    frame(time) { now = time; sandbox.app.analyseFrame(); },
    at(time) { now = time; },
    due(time) { now = time; for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn(); } },
    get activeIntervals() { return [...timers.values()].filter(t => t.interval).length; },
  };
}

test('麦克风启停释放全部资源，绝不把麦克风接入扬声器', async () => {
  const h = setup(); await h.app.startListening();
  assert.equal(h.app.state.listening, true);
  assert.equal(h.permissionCalls, 1);
  assert.equal(h.constraints.audio.echoCancellation, false);
  assert.equal(h.constraints.video, false);
  assert.equal(h.contexts[0].links.includes(h.contexts[0].destination), false);
  assert.equal(h.activeIntervals, 1);
  h.app.stopListening();
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.contexts[0].state, 'closed');
  assert.equal(h.activeIntervals, 0);
  assert.equal(h.app.state.listening, false);
  assert.equal(h.el('#detected-frequency').textContent, '—');
});

test('授权尚未完成时离开页面，迟到的录音流也会被释放', async () => {
  const permission = defer(), h = setup({ permission });
  const starting = h.app.startListening();
  for (let i = 0; i < 10 && !h.permissionCalls; i++) await Promise.resolve();
  assert.equal(h.permissionCalls, 1, 'Fixture must reach the pending system permission request');
  h.app.showView('guide');
  const stream = h.createStream(); permission.resolve(stream); await starting;
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.app.state.listening, false);
  assert.equal(h.activeIntervals, 0);
  assert.equal(h.contexts[0].state, 'closed');
});

test('音频初始化尚未完成时取消，不再向系统请求麦克风', async () => {
  const resume = defer(), h = setup({ resume });
  const starting = h.app.startListening();
  h.app.showView('guide'); resume.resolve(); await starting;
  assert.equal(h.permissionCalls, 0);
  assert.equal(h.app.state.pending, false);
  assert.equal(h.contexts[0].state, 'closed');
});

test('拒绝麦克风权限后，恢复可操作界面并解释错误', async () => {
  const permission = defer(), h = setup({ permission });
  const starting = h.app.startListening();
  permission.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  await starting;
  assert.equal(h.app.state.pending, false);
  assert.equal(h.el('#listen-button').disabled, false);
  assert.match(h.el('#error-message').textContent, /权限/);
  assert.equal(h.contexts[0].state, 'closed');
});

test('后台和原生暂停事件停止麦克风，旧流 ended 不会终止新会话', async () => {
  const h = setup(); await h.app.startListening(); const old = h.tracks[0];
  await h.window.emit('guqin-native-pause');
  assert.equal(old.stopped, true);
  await h.app.startListening(); await old.emit('ended');
  assert.equal(h.app.state.listening, true);
  h.document.hidden = true; await h.document.emit('visibilitychange');
  assert.equal(h.app.state.listening, false);
  assert.equal(h.tracks[1].stopped, true);
});

test('只有连续稳定音准才成功，失去音频立即撤销成功标记', async () => {
  const h = setup(); await h.app.startListening();
  for (let time = 2000; time <= 2600; time += 100) h.frame(time);
  assert.equal(h.el('.tuner-card').classList.contains('in-tune'), false);
  h.frame(2700);
  assert.equal(h.el('.tuner-card').classList.contains('in-tune'), true);
  h.frequency = 0; h.frame(2800);
  assert.equal(h.el('.tuner-card').classList.contains('in-tune'), false);
  assert.notEqual(h.el('#tuning-hint').textContent, '音准已合 · 清音正好');
  h.frame(3500);
  assert.equal(h.el('#detected-frequency').textContent, '—');
});

test('参考音期间忽略同频音，结束并等待余音后重新判定', async () => {
  const h = setup(); await h.app.startListening(); h.at(2000); await h.app.playTone();
  for (let time = 2100; time <= 4600; time += 100) h.frame(time);
  assert.equal(h.el('.tuner-card').classList.contains('in-tune'), false);
  assert.equal(h.el('#detected-frequency').textContent, '—');
  h.due(4750); h.frame(5000);
  assert.equal(h.el('#detected-frequency').textContent, '—');
  h.frame(5400);
  assert.notEqual(h.el('#detected-frequency').textContent, '—');
  assert.equal(h.el('.tuner-card').classList.contains('in-tune'), false);
});

test('自动识弦需要连续确认，手动选择关闭自动，慢二禁止同音自动识别', async () => {
  const h = setup(); await h.app.startListening();
  await h.el('#auto-toggle').emit('click');
  h.frequency = getStrings()[4].frequency;
  h.frame(2000); h.frame(2100); assert.equal(h.app.state.selected, 1);
  h.frame(2200); assert.equal(h.app.state.selected, 5);
  h.app.selectString(2); assert.equal(h.app.state.auto, false);
  await h.el('#auto-toggle').emit('click');
  h.app.selectTuning('maner'); assert.equal(h.app.state.auto, false);
  await h.el('#auto-toggle').emit('click'); assert.equal(h.app.state.auto, false);
});

test('自动识弦不会跨无信号间隔累加确认次数', async () => {
  const h = setup(); await h.app.startListening(); await h.el('#auto-toggle').emit('click');
  const frequency = getStrings()[4].frequency;
  for (const time of [2000, 2200, 2400]) {
    h.frequency = frequency; h.frame(time);
    h.frequency = 0; h.frame(time + 100);
  }
  assert.equal(h.app.state.selected, 1);
});

test('可辨别偏高和偏低，并拒绝将大幅八度差提示为微调方向', async () => {
  const h = setup(); await h.app.startListening();
  h.frequency = getStrings()[0].frequency * 2 ** (-25/1200); h.frame(2000);
  assert.match(h.el('#tuning-hint').textContent, /偏低/);
  h.app.selectString(1);
  h.frequency = getStrings()[0].frequency * 2 ** (25/1200); h.frame(2700);
  assert.match(h.el('#tuning-hint').textContent, /偏高/);
  h.frequency = getStrings()[0].frequency * 2; h.frame(2800);
  assert.match(h.el('#tuning-hint').textContent, /八度/);
});
