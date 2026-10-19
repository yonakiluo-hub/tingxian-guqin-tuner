import { TUNINGS, getStrings } from './tunings.js';
import { detectPitch, centsBetween, nearestString } from './pitch.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const noteHtml = note => note.replace(/(\d+)$/, '<sub>$1</sub>');
const shortNote = note => note.replace(/2/g, '₂').replace(/3/g, '₃');
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
let saved = {};
try { saved = JSON.parse(localStorage.getItem('tingxian-settings') || '{}') || {}; } catch { /* Private browsing/storage can be unavailable. */ }
const state = {
  tuning: TUNINGS.some(t => t.id === saved.tuning) ? saved.tuning : 'zheng',
  a4: Number.isFinite(saved.a4) && saved.a4 >= 415 && saved.a4 <= 466 ? saved.a4 : 440,
  selected: Number.isInteger(saved.selected) && saved.selected >= 1 && saved.selected <= 7 ? saved.selected : 1,
  auto: saved.auto === true && saved.tuning !== 'maner',
  listening: false, pending: false, view: 'tuner',
};
let strings = getStrings(state.tuning, state.a4);
let stream, context, analyser, source, frame, pcm, session = 0;
let history = [], lastValid = 0, stableSince = 0, autoCandidate = 0, autoCount = 0;
let toneContext, toneTimer, toneGeneration = 0, ignoreUntil = 0, installPrompt, toastTimer;

function persist() {
  try { localStorage.setItem('tingxian-settings', JSON.stringify({ tuning: state.tuning, a4: state.a4, selected: state.selected, auto: state.auto })); } catch { /* App still works without persistence. */ }
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function setHint(message) { if ($('#tuning-hint').textContent !== message) $('#tuning-hint').textContent = message; }
function showError(message) { $('#error-message').textContent = message; $('#error-message').hidden = !message; }
function setStatus(message) { $('.listening-status span').textContent = message; }
function resetReading(message) {
  history = []; stableSince = 0; lastValid = 0; autoCandidate = 0; autoCount = 0;
  $('.tuner-card').classList.remove('has-pitch', 'in-tune', 'off-pitch');
  $('#cents-value').textContent = '—'; $('#detected-frequency').textContent = '—';
  $('#meter-needle').style.transform = 'rotate(0deg)';
  $('#meter').setAttribute('aria-valuenow', '0'); $('#meter').setAttribute('aria-valuetext', '尚未检测到声音');
  setHint(message || `轻拨${strings[state.selected - 1].name}，让琴声慢慢舒展`);
}
function renderSelection() {
  const selected = strings[state.selected - 1];
  $('#selected-string').textContent = selected.name;
  $('#target-note').innerHTML = noteHtml(selected.note);
  $('#target-frequency').textContent = selected.frequency.toFixed(2);
  $$('.string-button').forEach(button => {
    const active = Number(button.dataset.string) === state.selected;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('#auto-toggle').setAttribute('aria-pressed', String(state.auto));
  $('#selection-mode').textContent = state.auto ? '自动识弦' : '手动选弦';
}
function renderTuning() {
  strings = getStrings(state.tuning, state.a4);
  const tuning = TUNINGS.find(item => item.id === state.tuning);
  $('#mode-name').textContent = tuning.name;
  $('#mode-description').textContent = tuning.description;
  $('#a4-label').textContent = state.a4;
  $('#strings-list').innerHTML = strings.map(s => `<button class="string-button" data-string="${s.number}" aria-label="${s.name}，${s.note}，目标 ${s.frequency.toFixed(2)} 赫兹" aria-pressed="false"><span class="string-number">${s.name[0]}</span><span class="string-line"></span><span class="string-info"><strong>${shortNote(s.note)}</strong><small>${s.frequency.toFixed(2)} <span>Hz</span></small></span></button>`).join('');
  $('#mode-options').innerHTML = TUNINGS.map(t => `<button class="mode-option ${t.id === state.tuning ? 'selected' : ''}" data-tuning="${t.id}"><span><strong>${t.name}</strong><small>${t.subtitle}</small></span>${t.id === state.tuning ? icon('check') : icon('chevron')}</button>`).join('');
  $('#mode-cards').innerHTML = TUNINGS.map(t => `<article class="mode-card ${t.id === state.tuning ? 'selected' : ''}"><div class="mode-card-heading"><h2>${t.name}</h2><span>${t.id === state.tuning ? '当前调式' : t.subtitle.split(' · ')[0]}</span></div><p>${t.description}</p><div class="mode-pitches">${t.noteNames.map((note, i) => `<span class="${t.changeString === i + 1 ? 'changed' : ''}"><small>${['一','二','三','四','五','六','七'][i]}弦</small>${shortNote(note)}</span>`).join('')}</div><button class="secondary-button" data-tuning="${t.id}">${t.id === state.tuning ? '开始调音' : '使用' + t.name}</button></article>`).join('');
  renderSelection(); resetReading();
}
function selectString(number, automatic = false) {
  if (!automatic) { state.auto = false; stopTone(); }
  state.selected = number; persist(); renderSelection(); resetReading();
}
function selectTuning(id) {
  if (!TUNINGS.some(t => t.id === id)) return;
  stopTone(); state.tuning = id;
  if (id === 'maner') state.auto = false;
  persist(); renderTuning(); $('#mode-dialog').close(); showView('tuner');
  toast(`${TUNINGS.find(t => t.id === id).name}已就位${id === 'maner' ? '，一二弦同音，请手动选弦' : ''}`);
}
function showView(view) {
  if (!['tuner','modes','guide'].includes(view)) view = 'tuner';
  if (view !== 'tuner') { stopListening(); stopTone(); }
  state.view = view;
  $$('.view').forEach(section => { section.hidden = section.id !== `view-${view}`; });
  $$('.nav-item').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  if (location.hash !== '#' + view) window.history.replaceState(null, '', '#' + view);
}
function renderMic() {
  $('.tuner-card').classList.toggle('is-listening', state.listening);
  $('#listen-button').disabled = state.pending;
  $('#listen-button span').textContent = state.pending ? '正在打开麦克风…' : state.listening ? '停止调音' : '开始调音';
  $('#micro-hint').textContent = state.listening ? '正在本机聆听 · 请逐根拨响空弦' : '允许使用麦克风后，拨响一根空弦';
  setStatus(state.pending ? '等待麦克风授权' : state.listening ? '正在聆听' : '准备就绪');
}
async function startListening() {
  if (state.pending || state.listening) return;
  showError('');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError('当前环境无法使用麦克风。请安装安卓应用，或在 Safari / Chrome 中通过 HTTPS 在线地址打开。'); return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) { showError('当前浏览器不支持音频分析，请使用较新版本的 Safari 或 Chrome。'); return; }
  stopTone();
  const token = ++session;
  state.pending = true; renderMic();
  let openedContext, openedStream;
  try {
    openedContext = new AudioContextClass(); context = openedContext;
    await openedContext.resume();
    if (token !== session || document.hidden) { if (openedContext.state !== 'closed') await openedContext.close(); return; }
    openedStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
    if (token !== session || document.hidden) { openedStream.getTracks().forEach(track => track.stop()); if (openedContext.state !== 'closed') await openedContext.close(); return; }
    stream = openedStream;
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0;
    source.connect(analyser); // Deliberately never connect microphone input to the speaker.
    pcm = new Float32Array(analyser.fftSize);
    stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (token === session && state.listening) { stopListening(); showError('麦克风已断开，请检查设备权限后重新开始。'); } }));
    state.listening = true; state.pending = false; resetReading(); renderMic();
    frame = setInterval(analyseFrame, 100);
  } catch (error) {
    openedStream?.getTracks().forEach(track => track.stop());
    if (openedContext && openedContext.state !== 'closed') await openedContext.close().catch(() => {});
    if (token !== session) return;
    state.listening = false; state.pending = false; context = null; stream = null; renderMic();
    const messages = {
      NotAllowedError: '麦克风权限未开启。请在系统或浏览器设置中允许麦克风，然后再点「开始调音」。',
      PermissionDeniedError: '麦克风权限未开启，请在系统或浏览器设置中允许后重试。',
      NotFoundError: '没有找到可用的麦克风，请检查设备或关闭蓝牙耳机后重试。',
      NotReadableError: '麦克风暂时不可用，可能正被其他应用占用。请关闭占用录音的应用后重试。',
      AbortError: '麦克风启动中断，请稍后再试。',
    };
    showError(messages[error.name] || '音频未能启动。请确认麦克风可用，并在 Safari 或 Chrome 中重新打开。');
  }
}
function stopListening(message) {
  ++session; clearInterval(frame); frame = null;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  try { source?.disconnect(); analyser?.disconnect(); } catch { /* Already disconnected. */ }
  source = null; analyser = null;
  if (context && context.state !== 'closed') context.close().catch(() => {});
  context = null; state.listening = false; state.pending = false; renderMic(); resetReading(message);
}
function analyseFrame() {
  if (!state.listening || !analyser || !context || document.hidden) return;
  const now = performance.now();
  if (now < ignoreUntil) { setStatus('参考音播放中 · 暂停检测'); return; }
  setStatus('正在聆听');
  analyser.getFloatTimeDomainData(pcm);
  const result = detectPitch(pcm, context.sampleRate);
  if (!result || result.confidence < .82) {
    stableSince = 0; autoCandidate = 0; autoCount = 0;
    $('.tuner-card').classList.remove('in-tune');
    if ($('#tuning-hint').textContent === '音准已合 · 清音正好') setHint('等待清晰的单弦声音');
    if (!lastValid || now - lastValid > 700) resetReading('等待清晰的单弦声音');
    return;
  }
  lastValid = now;
  let frequency = result.frequency;
  if (history.length && Math.abs(centsBetween(frequency, history[history.length - 1])) > 60) { history = []; stableSince = 0; }
  history.push(frequency); if (history.length > 5) history.shift();
  const sorted = [...history].sort((a,b) => a-b); frequency = sorted[Math.floor(sorted.length / 2)];
  if (state.auto) {
    const nearest = nearestString(frequency, strings);
    if (nearest && Math.abs(nearest.cents) <= 150 && nearest.number !== state.selected) {
      if (autoCandidate === nearest.number) autoCount++; else { autoCandidate = nearest.number; autoCount = 1; }
      if (autoCount >= 3) { selectString(nearest.number, true); lastValid = now; history = [frequency]; }
    } else { autoCandidate = 0; autoCount = 0; }
  }
  const target = strings[state.selected - 1];
  const cents = centsBetween(frequency, target.frequency);
  const rounded = Math.round(cents);
  $('.tuner-card').classList.add('has-pitch');
  $('#cents-value').textContent = rounded > 0 ? '+' + rounded : String(rounded);
  $('#detected-frequency').textContent = frequency.toFixed(2);
  $('#meter-needle').style.transform = `rotate(${Math.max(-50, Math.min(50, cents)) * 1.35}deg)`;
  $('#meter').setAttribute('aria-valuenow', String(Math.max(-50, Math.min(50, rounded))));
  $('#meter').setAttribute('aria-valuetext', `${target.name}偏差 ${rounded} 音分，实际 ${frequency.toFixed(2)} 赫兹`);
  const close = Math.abs(cents) <= 5;
  if (close) { if (!stableSince) stableSince = now; } else stableSince = 0;
  const inTune = close && now - stableSince >= 650 && history.length >= 4;
  $('.tuner-card').classList.toggle('in-tune', inTune);
  $('.tuner-card').classList.toggle('off-pitch', !close);
  if (Math.abs(cents) > 200) setHint('音高相差较大，请先确认弦号与八度');
  else if (state.auto && Math.abs(cents) > 150) setHint('暂未找到相近琴弦，请手动选弦');
  else if (inTune) setHint('音准已合 · 清音正好');
  else if (close) setHint('接近准确，请保持声音稳定');
  else setHint(cents < 0 ? '音偏低，轻轻紧一点弦' : '音偏高，轻轻松一点弦');
}
async function stopTone() {
  const wasPlaying = !!toneContext;
  ++toneGeneration; clearTimeout(toneTimer); toneTimer = null;
  if (toneContext && toneContext.state !== 'closed') toneContext.close().catch(() => {});
  toneContext = null; $('#tone-button').classList.remove('playing'); $('#tone-button span').textContent = '听参考音';
  // Leave a short quiet window for room/speaker decay.
  if (wasPlaying) ignoreUntil = performance.now() + 550;
}
async function playTone() {
  if (toneContext) { stopTone(); resetReading(); return; }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) { showError('当前浏览器不支持参考音播放，请更换浏览器。'); return; }
  stopTone(); const token = toneGeneration;
  try {
    const playback = new AudioContextClass(); toneContext = playback;
    await playback.resume();
    if (token !== toneGeneration || document.hidden) { if (playback.state !== 'closed') playback.close().catch(() => {}); return; }
    const now = playback.currentTime, frequency = strings[state.selected - 1].frequency;
    const gain = playback.createGain(); gain.connect(playback.destination);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.22, now + .05); gain.gain.exponentialRampToValueAtTime(.015, now + 2.3); gain.gain.linearRampToValueAtTime(0, now + 2.65);
    [1, 2, 3].forEach((harmonic, i) => {
      const osc = playback.createOscillator(), level = playback.createGain();
      osc.type = 'sine'; osc.frequency.value = frequency * harmonic; level.gain.value = [1, .3, .1][i];
      osc.connect(level); level.connect(gain); osc.start(now); osc.stop(now + 2.7);
    });
    ignoreUntil = performance.now() + 3350; resetReading('参考音播放中，请听辨散音');
    $('#tone-button').classList.add('playing'); $('#tone-button span').textContent = '停止参考音';
    toneTimer = setTimeout(() => { if (token === toneGeneration) { stopTone(); resetReading(); } }, 2750);
  } catch { stopTone(); showError('参考音未能播放，请检查手机的媒体音量后再试。'); }
}

function openSettings() {
  $('#a4-input').value = state.a4; $('#settings-error').hidden = true; $('#settings-dialog').showModal();
}
function saveSettings() {
  const a4 = Number($('#a4-input').value);
  if (!Number.isInteger(a4) || a4 < 415 || a4 > 466) { $('#settings-error').textContent = '请输入 415–466 之间的整数。'; $('#settings-error').hidden = false; return; }
  stopTone(); state.a4 = a4; persist(); renderTuning(); $('#settings-dialog').close(); toast(`标准音已设为 A4 = ${a4} Hz`);
}

$('#strings-list').addEventListener('click', event => { const button = event.target.closest('[data-string]'); if (button) selectString(Number(button.dataset.string)); });
$('#mode-options').addEventListener('click', event => { const button = event.target.closest('[data-tuning]'); if (button) selectTuning(button.dataset.tuning); });
$('#mode-cards').addEventListener('click', event => { const button = event.target.closest('[data-tuning]'); if (button) selectTuning(button.dataset.tuning); });
$$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('.brand').addEventListener('click', event => { event.preventDefault(); showView('tuner'); });
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
$('#listen-button').addEventListener('click', () => state.listening ? stopListening() : startListening());
$('#tone-button').addEventListener('click', playTone);
$('#auto-toggle').addEventListener('click', () => {
  if (state.tuning === 'maner') { toast('慢二的一、二弦同音，请手动选择琴弦'); return; }
  state.auto = !state.auto; persist(); renderSelection(); resetReading();
  toast(state.auto ? '自动识弦已开启，请逐根拨弦' : '已切换为手动选弦');
});
$('#mode-open').addEventListener('click', () => $('#mode-dialog').showModal());
$('#settings-open').addEventListener('click', openSettings);
$('#calibration-open').addEventListener('click', openSettings);
$('#settings-done').addEventListener('click', saveSettings);
$('#a4-input').addEventListener('keydown', event => { if (event.key === 'Enter') saveSettings(); });
$('#a4-minus').addEventListener('click', () => { const value = Number($('#a4-input').value) || 440; $('#a4-input').value = Math.max(415, Math.min(466, value - 1)); });
$('#a4-plus').addEventListener('click', () => { const value = Number($('#a4-input').value) || 440; $('#a4-input').value = Math.max(415, Math.min(466, value + 1)); });
$('#a4-reset').addEventListener('click', () => { $('#a4-input').value = 440; });
$$('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); }));

const pause = () => { stopTone(); stopListening('已暂停，再次点击开始即可继续'); };
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', pause);
window.addEventListener('guqin-native-pause', pause);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
$('#install-button').addEventListener('click', async () => {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) { $('#install-help').textContent = '当前已在独立应用窗口中运行。'; return; }
  if (location.hostname === 'appassets.androidplatform.net') { $('#install-help').textContent = '你已在安卓应用中，无需重复添加。'; return; }
  if (installPrompt) { await installPrompt.prompt(); const choice = await installPrompt.userChoice; installPrompt = null; $('#install-help').textContent = choice.outcome === 'accepted' ? '已添加到主屏幕。' : '你可以随时从浏览器菜单添加。'; return; }
  $('#install-help').textContent = /iPhone|iPad|iPod/.test(navigator.userAgent) ? '在 Safari 中点击分享按钮，再选择「添加到主屏幕」。' : '在 Chrome 或 Edge 浏览器菜单中选择「安装应用」或「添加到主屏幕」。';
});

// Tick marks follow the same circular scale as the pointer.
$('#meter-ticks').innerHTML = Array.from({length:21}, (_, i) => {
  const angle = (-67.5 + i * 6.75) * Math.PI / 180;
  const x1 = 220 + Math.sin(angle) * 184, y1 = 215 - Math.cos(angle) * 184;
  const length = i % 5 === 0 ? 11 : 6;
  return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}l${(-Math.sin(angle) * length).toFixed(1)} ${(Math.cos(angle) * length).toFixed(1)}"/>`;
}).join('');
renderTuning(); renderMic(); showView(location.hash.slice(1) || 'tuner');
// Native Android assets already work offline. Register a worker only in browsers.
if ('serviceWorker' in navigator && window.isSecureContext && location.hostname !== 'appassets.androidplatform.net') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* Online use remains available. */ }); });
}
