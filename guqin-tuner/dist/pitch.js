/**
 * Single-note pitch estimation for open guqin strings.
 * Uses a YIN-style cumulative normalized difference and parabolic refinement.
 * It is not polyphonic and deliberately returns null for uncertain frames.
 */
export function detectPitch(input, sampleRate, options = {}) {
  const { minFrequency = 45, maxFrequency = 400, minRms = 0.003 } = options;
  if (!input || input.length < 512 || !Number.isFinite(sampleRate) || sampleRate < 8000 ||
      !Number.isFinite(minFrequency) || !Number.isFinite(maxFrequency) ||
      minFrequency <= 0 || maxFrequency <= minFrequency || maxFrequency > sampleRate / 4) return null;

  // Limit work to the newest 16k samples. Box averaging before decimation reduces
  // high-frequency energy while preserving the 45–400 Hz range of interest.
  const count = Math.min(input.length, 16384);
  const offset = input.length - count;
  let mean = 0;
  for (let i = offset; i < input.length; i++) mean += input[i];
  mean /= count;
  if (!Number.isFinite(mean)) return null;
  let energy = 0;
  for (let i = offset; i < input.length; i++) energy += (input[i] - mean) ** 2;
  const rms = Math.sqrt(energy / count);
  if (rms < minRms || !Number.isFinite(rms)) return null;

  const step = Math.max(1, Math.floor(sampleRate / 11025));
  const rate = sampleRate / step;
  const samples = new Float64Array(Math.floor(count / step));
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += input[offset + i * step + j] - mean;
    samples[i] = sum / step;
  }
  const minLag = Math.max(2, Math.floor(rate / maxFrequency));
  const maxLag = Math.min(Math.ceil(rate / minFrequency), Math.floor(samples.length / 3));
  if (maxLag <= minLag + 2) return null;
  const windowLength = samples.length - maxLag - 1;
  const difference = new Float64Array(maxLag + 2);
  let cumulative = 0;
  difference[0] = 1;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i < windowLength; i++) {
      const delta = samples[i] - samples[i + lag];
      sum += delta * delta;
    }
    cumulative += sum;
    difference[lag] = cumulative > 0 ? sum * lag / cumulative : 1;
  }

  // Find the best periodic candidates, then use the shortest period whose fit
  // is close to the best. The stricter relative gate helps avoid mistaking a
  // loud second harmonic for the much quieter fundamental of a plucked string.
  const minima = [];
  let best = 1;
  // Also inspect periods shorter than the requested range: otherwise a pure
  // 440 Hz tone could be mistaken for its third-period repetition at 146.7 Hz.
  for (let lag = 2; lag <= maxLag; lag++) {
    if (difference[lag] <= difference[lag - 1] && difference[lag] < difference[lag + 1]) {
      const left = difference[lag - 1];
      const center = difference[lag];
      const right = difference[lag + 1];
      const denominator = left - 2 * center + right;
      const shift = Math.abs(denominator) > 1e-12 ? 0.5 * (left - right) / denominator : 0;
      const depth = Math.max(0, center - 0.25 * (left - right) * shift);
      minima.push({ lag, shift: Math.max(-0.5, Math.min(0.5, shift)), depth });
      best = Math.min(best, depth);
    }
  }
  if (minima.length === 0 || best > 0.18) return null;
  const threshold = Math.min(0.18, Math.max(0.004, best * 1.25));
  const candidate = minima.find(value => value.depth <= threshold);
  if (!candidate) return null;
  const frequency = rate / (candidate.lag + candidate.shift);
  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency) return null;
  return { frequency, confidence: Math.max(0, Math.min(1, 1 - candidate.depth)), rms };
}

export function centsBetween(actual, target) {
  return actual > 0 && target > 0 ? 1200 * Math.log2(actual / target) : NaN;
}

/** Exact measured frequency comparison: never silently fold a harmonic/octave. */
export function nearestString(frequency, strings) {
  if (!Number.isFinite(frequency) || frequency <= 0 || !strings?.length) return null;
  let nearest = null;
  for (const string of strings) {
    const cents = centsBetween(frequency, string.frequency);
    if (!nearest || Math.abs(cents) < Math.abs(nearest.cents)) nearest = { ...string, cents };
  }
  return nearest;
}
