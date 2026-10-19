import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { detectPitch, centsBetween, nearestString } from '../dist/pitch.js';
import { TUNINGS, getStrings, midiToFrequency } from '../dist/tunings.js';

// Deterministic recordings with specified harmonics, decay, DC and noise.
function signal(frequency, sampleRate, length, options = {}) {
  const { harmonics = [1], amplitude = 0.3, noise = 0, decay = 0, dc = 0, phase = 0.31 } = options;
  let seed = 38137;
  const total = harmonics.reduce((a, b) => a + Math.abs(b), 0) || 1;
  return Float32Array.from({ length }, (_, i) => {
    const t = i / sampleRate;
    let value = 0;
    for (let h = 0; h < harmonics.length; h++) {
      value += harmonics[h] * Math.sin(2 * Math.PI * frequency * (h + 1) * t + phase * (h + 1));
    }
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return dc + amplitude * value / total * Math.exp(-decay * t) + noise * (seed / 2 ** 31 - 1);
  });
}

function expectPitch(frequency, sampleRate, length, options = {}, tolerance = 2) {
  const result = detectPitch(signal(frequency, sampleRate, length, options), sampleRate);
  assert.ok(result, `No pitch for ${frequency.toFixed(3)} Hz at ${sampleRate}/${length}`);
  const error = Math.abs(centsBetween(result.frequency, frequency));
  assert.ok(error < tolerance,
    `${frequency.toFixed(3)} Hz detected as ${result.frequency.toFixed(3)} Hz: ${error.toFixed(3)} cents`);
  assert.ok(result.confidence >= 0.82 && result.confidence <= 1);
  return error;
}

test('四种弦式均含七根弦，慢三/紧五/慢二的变弦与频率正确', () => {
  assert.equal(TUNINGS.length, 4);
  for (const tuning of TUNINGS) assert.equal(getStrings(tuning.id).length, 7);
  assert.deepEqual(getStrings('zheng').map(s => s.note), ['C2', 'D2', 'F2', 'G2', 'A2', 'C3', 'D3']);
  assert.equal(getStrings('mansan')[2].note, 'E2');
  assert.equal(getStrings('jinwu')[4].note, 'B♭2');
  assert.equal(getStrings('maner')[0].frequency, getStrings('maner')[1].frequency);
  assert.ok(Math.abs(getStrings()[0].frequency - 65.406391325) < 1e-8);
  assert.equal(midiToFrequency(69), 440);
  assert.equal(midiToFrequency(69, 442), 442);
  assert.ok(Math.abs(getStrings('zheng', 442)[4].frequency - 110.5) < 1e-12);
});

test('全部弦式、44.1/48 kHz、8192/16384 采样：误差小于 2 音分', () => {
  let maxError = 0;
  let count = 0;
  for (const sampleRate of [44100, 48000]) {
    for (const length of [8192, 16384]) {
      for (const tuning of TUNINGS) {
        for (const string of getStrings(tuning.id)) {
          maxError = Math.max(maxError, expectPitch(string.frequency, sampleRate, length));
          count++;
        }
      }
    }
  }
  console.log(`Clean tones: ${count} cases; maximum error ${maxError.toFixed(3)} cents`);
});

test('各弦 ±5、±25、±50、±100 音分：方向和频差正确', () => {
  let maxError = 0;
  for (const string of getStrings()) {
    for (const cents of [-100, -50, -25, -5, 5, 25, 50, 100]) {
      const frequency = string.frequency * 2 ** (cents / 1200);
      maxError = Math.max(maxError, expectPitch(frequency, 48000, 8192));
      const detected = detectPitch(signal(frequency, 48000, 8192), 48000);
      assert.equal(Math.sign(centsBetween(detected.frequency, string.frequency)), Math.sign(cents));
    }
  }
  console.log(`Detuned tones: 56 cases; maximum error ${maxError.toFixed(3)} cents`);
});

test('低音古琴：弱基音、强二/三次泛音、衰减、噪声和直流偏置', () => {
  let maxError = 0;
  for (const sampleRate of [44100, 48000]) {
    for (const length of [8192, 16384]) {
      for (const string of getStrings()) {
        for (const harmonics of [[0.08, 1, 0.45, 0.3, 0.15], [0.1, 1, 0.04], [0, 1, 0.45, 0.2]]) {
          maxError = Math.max(maxError, expectPitch(string.frequency, sampleRate, length,
            { harmonics, amplitude: 0.5, decay: 3, noise: 0.015, dc: 0.07 }, 3));
        }
      }
    }
  }
  console.log(`Harmonic/decay/noise tones: 84 cases; maximum error ${maxError.toFixed(3)} cents`);
});

test('安静、直流、低电平、无规则噪声、无效输入不显示音高', () => {
  assert.equal(detectPitch(new Float32Array(8192), 48000), null);
  assert.equal(detectPitch(new Float32Array(8192).fill(0.5), 48000), null);
  assert.equal(detectPitch(signal(65.4, 48000, 8192, { amplitude: 0.001 }), 48000), null);
  assert.equal(detectPitch(signal(65.4, 48000, 8192, { amplitude: 0, noise: 0.5 }), 48000), null);
  assert.equal(detectPitch(signal(65.4, 48000, 8192, { amplitude: 0, noise: 0.03 }), 48000), null);
  assert.equal(detectPitch(null, 48000), null);
  assert.equal(detectPitch(new Float32Array(8192).fill(NaN), 48000), null);
  assert.equal(detectPitch(new Float32Array(8192), 0), null);
});

test('自动识别不悄悄折叠八度，慢二同音弦保持第一根匹配', () => {
  const strings = getStrings();
  for (const string of strings) {
    assert.equal(nearestString(string.frequency * 2 ** (12 / 1200), strings).number, string.number);
  }
  assert.equal(nearestString(strings[0].frequency * 2, strings).number, 6);
  assert.equal(nearestString(getStrings('maner')[1].frequency, getStrings('maner')).number, 1);
  assert.equal(nearestString(0, strings), null);
});

test('频率范围边缘准确，范围外纯音不会被折叠成可调音高', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const frequency of [45.1, 46, 55, 220, 399]) expectPitch(frequency, sampleRate, 8192);
    for (const frequency of [30, 40, 44, 410, 440, 880, 1000]) {
      assert.equal(detectPitch(signal(frequency, sampleRate, 8192), sampleRate), null,
        `Out-of-range ${frequency} Hz must not be assigned a subharmonic`);
    }
  }
});

test('100 ms 更新周期内完成计算：100 次耗时报告', () => {
  const buffer = signal(65.406391325, 48000, 16384, { harmonics: [0.1, 1, 0.5, 0.2] });
  for (let i = 0; i < 10; i++) detectPitch(buffer, 48000);
  const start = performance.now();
  for (let i = 0; i < 100; i++) detectPitch(buffer, 48000);
  const meanMs = (performance.now() - start) / 100;
  console.log(`Local desktop mean processing time: ${meanMs.toFixed(2)} ms/frame (mobile not benchmarked)`);
  assert.ok(meanMs < 100, `Pitch processing exceeds 100 ms: ${meanMs}`);
});
