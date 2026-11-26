import { geometricAcceptance } from '../contract/geometricContract';
import type { ThicknessProfile } from './types';

export interface SignedDistanceField {
  width: number;
  height: number;
  /**
   * Distância à fronteira, em pixels.
   * Negativa no interior da máscara, positiva no exterior.
   * O zero coincide com a fronteira entre centros de pixel (ajuste de 0,5 px).
   */
  values: Float32Array;
}

const INF = 1e20;

function edt1d(f: Float64Array): Float64Array {
  const n = f.length;
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (k > 0 && s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
  return d;
}

function euclideanDistance(feature: Uint8Array, width: number, height: number): Float32Array {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = feature[i] ? 0 : INF;

  const col = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = grid[y * width + x];
    const dist = edt1d(col);
    for (let y = 0; y < height; y++) grid[y * width + x] = dist[y];
  }

  const row = new Float64Array(width);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = grid[y * width + x];
    const dist = edt1d(row);
    for (let x = 0; x < width; x++) {
      const value = dist[x];
      out[y * width + x] = value >= INF / 2 ? Infinity : Math.sqrt(value);
    }
  }
  return out;
}

/**
 * Campo de distância assinado exato (transformada de Felzenszwalb) sobre uma máscara binária.
 * Serve para estimar espessura, localizar a borda, medir cavidades e a distância entre regiões.
 * Não é uma isossuperfície e não é emitido como caminho SVG.
 */
export function computeSignedDistanceField(
  mask: Uint8Array,
  width: number,
  height: number
): SignedDistanceField {
  const inside = new Uint8Array(mask.length);
  const outside = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) inside[i] = 1;
    else outside[i] = 1;
  }
  const distToInside = euclideanDistance(inside, width, height);
  const distToOutside = euclideanDistance(outside, width, height);
  const values = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) values[i] = -(distToOutside[i] - 0.5);
    else values[i] = distToInside[i] - 0.5;
  }
  return { width, height, values };
}

export function sampleSdf(sdf: SignedDistanceField, x: number, y: number): number {
  const { width, height, values } = sdf;
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) {
    const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
    return values[cy * width + cx];
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = values[y0 * width + x0];
  const i10 = values[y0 * width + x1];
  const i01 = values[y1 * width + x0];
  const i11 = values[y1 * width + x1];
  return (1 - tx) * (1 - ty) * i00 + tx * (1 - ty) * i10 + (1 - tx) * ty * i01 + tx * ty * i11;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? 0.5 * (sorted[mid - 1] + sorted[mid]) : sorted[mid];
}

/**
 * Espessura local ao longo do eixo medial: corda que atravessa a máscara na direção do gradiente do SDF.
 * Em um traço simétrico a corda mede a largura integral, não apenas o raio até a borda mais próxima.
 */
export function measureMedialThickness(
  sdf: SignedDistanceField,
  mask: Uint8Array
): ThicknessProfile {
  const { width, height, values } = sdf;
  const chords: number[] = [];

  const march = (x: number, y: number, dx: number, dy: number): number => {
    let cx = x;
    let cy = y;
    let traveled = 0;
    for (let step = 0; step < 500; step++) {
      cx += dx * 0.25;
      cy += dy * 0.25;
      traveled += 0.25;
      const ix = Math.round(cx);
      const iy = Math.round(cy);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height || !mask[iy * width + ix]) {
        return Math.max(0, traveled - 0.25);
      }
    }
    return traveled;
  };

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (!mask[idx] || values[idx] >= -0.2) continue;
      const gx = values[idx + 1] - values[idx - 1];
      const gy = values[idx + width] - values[idx - width];
      const mag = Math.hypot(gx, gy);
      if (mag < 0.15) continue;
      const ux = gx / mag;
      const uy = gy / mag;
      const ahead = sampleSdf(sdf, x + ux, y + uy);
      const behind = sampleSdf(sdf, x - ux, y - uy);
      if (!(values[idx] < ahead - 0.04 && values[idx] < behind - 0.04)) continue;
      const thickness = march(x, y, ux, uy) + march(x, y, -ux, -uy);
      if (thickness > 0.4 && thickness < Math.max(width, height)) chords.push(thickness);
      if (chords.length >= 500) break;
    }
    if (chords.length >= 500) break;
  }

  if (chords.length === 0) {
    return {
      samples: 0,
      medianPx: 0,
      meanPx: 0,
      stdPx: 0,
      stdRatio: 0,
      minPx: 0,
      maxPx: 0,
      maxBiasPx: 0,
      withinContract: false,
    };
  }

  return profileFromValues(chords);
}

/**
 * Menor distância entre centros de pixel de duas máscaras, menos 1 px,
 * para que vizinhos de grade (regiões que se tocam) meçam aproximadamente 0.
 */
export function boundaryDistancePx(maskA: Uint8Array, maskB: Uint8Array, width: number, height: number): number {
  const dist = euclideanDistance(maskA, width, height);
  let best = Infinity;
  for (let i = 0; i < maskB.length; i++) {
    if (maskB[i] && dist[i] < best) best = dist[i];
  }
  if (!Number.isFinite(best)) return Infinity;
  return Math.max(0, best - 1);
}

export function profileFromValues(chords: number[]): ThicknessProfile {
  if (chords.length === 0) {
    return {
      samples: 0,
      medianPx: 0,
      meanPx: 0,
      stdPx: 0,
      stdRatio: 0,
      minPx: 0,
      maxPx: 0,
      maxBiasPx: 0,
      withinContract: false,
    };
  }
  const med = median(chords);
  let mean = 0;
  let minPx = Infinity;
  let maxPx = 0;
  let maxBias = 0;
  for (const value of chords) {
    mean += value;
    if (value < minPx) minPx = value;
    if (value > maxPx) maxPx = value;
    maxBias = Math.max(maxBias, Math.abs(value - med));
  }
  mean /= chords.length;
  let variance = 0;
  for (const value of chords) variance += (value - mean) * (value - mean);
  const std = Math.sqrt(variance / chords.length);
  const stdRatio = med > 1e-6 ? std / med : 0;
  return {
    samples: chords.length,
    medianPx: Number(med.toFixed(3)),
    meanPx: Number(mean.toFixed(3)),
    stdPx: Number(std.toFixed(3)),
    stdRatio: Number(stdRatio.toFixed(3)),
    minPx: Number(minPx.toFixed(3)),
    maxPx: Number(maxPx.toFixed(3)),
    maxBiasPx: Number(maxBias.toFixed(3)),
    withinContract:
      stdRatio <= geometricAcceptance.stroke.thicknessStdRatio &&
      maxBias <= geometricAcceptance.stroke.thicknessBiasPx,
  };
}
