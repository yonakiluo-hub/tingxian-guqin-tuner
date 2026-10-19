// Scientific pitch notation; modern reference pitches in twelve-tone equal temperament.
// Traditional guqin harmonic tuning and historical pitch standards can differ.
export const TUNINGS = Object.freeze([
  { id: 'zheng', name: '正调', subtitle: '仲吕 · 最常用',
    description: '常用正调：一至七弦 C、D、F、G、A、C、D。',
    midi: [36, 38, 41, 43, 45, 48, 50],
    noteNames: ['C2', 'D2', 'F2', 'G2', 'A2', 'C3', 'D3'], changeString: null },
  { id: 'mansan', name: '慢三', subtitle: '慢角调 · 三弦降低半音',
    description: '以正调为基础，将三弦由 F2 降至 E2，其余六弦不变。',
    midi: [36, 38, 40, 43, 45, 48, 50],
    noteNames: ['C2', 'D2', 'E2', 'G2', 'A2', 'C3', 'D3'], changeString: 3 },
  { id: 'jinwu', name: '紧五', subtitle: '蕤宾调 · 五弦升高半音',
    description: '以正调为基础，将五弦由 A2 升至 B♭2，其余六弦不变。',
    midi: [36, 38, 41, 43, 46, 48, 50],
    noteNames: ['C2', 'D2', 'F2', 'G2', 'B♭2', 'C3', 'D3'], changeString: 5 },
  { id: 'maner', name: '慢二', subtitle: '慢商调 · 广陵散弦式',
    description: '以正调为基础，将二弦由 D2 降至 C2，与一弦同音；请手动选弦。',
    midi: [36, 36, 41, 43, 45, 48, 50],
    noteNames: ['C2', 'C2', 'F2', 'G2', 'A2', 'C3', 'D3'], changeString: 2 },
].map(tuning => Object.freeze({ ...tuning,
  midi: Object.freeze(tuning.midi), noteNames: Object.freeze(tuning.noteNames) })));

export const TUNING_SOURCES = Object.freeze([
  { title: '故宫博物院：古琴的定弦方式', url: 'https://www.dpm.org.cn/Uploads/File/2022/10/25/u6357951133e58.pdf' },
  { title: 'Atlas Ensemble：Guqin by Ziwen Kong', url: 'https://www.atlasensemble.nl/assets/files/instruments/Guqin/Guqin%20by%20Ziwen%20Kong.pdf' },
]);

export function midiToFrequency(midi, a4 = 440) {
  if (!Number.isFinite(midi) || !Number.isFinite(a4) || a4 <= 0) {
    throw new RangeError('音高与标准音必须为有效数值。');
  }
  return a4 * 2 ** ((midi - 69) / 12);
}

export function getStrings(tuningId = 'zheng', a4 = 440) {
  const tuning = TUNINGS.find(item => item.id === tuningId) || TUNINGS[0];
  const names = ['一弦', '二弦', '三弦', '四弦', '五弦', '六弦', '七弦'];
  return tuning.midi.map((midi, i) => ({
    number: i + 1, name: names[i], note: tuning.noteNames[i], midi,
    frequency: midiToFrequency(midi, a4),
  }));
}
