import { deltaEOklab } from '../color/perceptualColor';

export type NoiseComponentClass =
  | 'real_structure'
  | 'legitimate_detail'
  | 'legitimate_opening'
  | 'compression_noise'
  | 'segmentation_noise'
  | 'antialiasing'
  | 'tonal_transition'
  | 'reconstruction_artifact';

export interface NoiseCleanupReport {
  classified: number;
  removedFragments: number;
  keptStructures: number;
  keptDetails: number;
  keptOpenings: number;
  revertedPixels: number;
  protectedRegionIds: number[];
  byClass: Record<NoiseComponentClass, number>;
}

interface RegionStats {
  id: number;
  pixels: number[];
  meanL: number;
  meanA: number;
  meanB: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY_COUNTS = (): Record<NoiseComponentClass, number> => ({
  real_structure: 0,
  legitimate_detail: 0,
  legitimate_opening: 0,
  compression_noise: 0,
  segmentation_noise: 0,
  antialiasing: 0,
  tonal_transition: 0,
  reconstruction_artifact: 0,
});

function chebyshevAt(
  data: Uint8Array,
  px: number,
  rgb: [number, number, number]
): number {
  const i = px * 4;
  return Math.max(
    Math.abs(data[i] - rgb[0]),
    Math.abs(data[i + 1] - rgb[1]),
    Math.abs(data[i + 2] - rgb[2])
  );
}

/**
 * Classifica fragmentos pequenos e só reatribui ruído de compressão, segmentação,
 * antialiasing e artefato. Traço fino, detalhe compacto de alto contraste e abertura
 * interna (olho de letra) não entram em regra global de área.
 * A máscara anterior é guardada e qualquer pixel protegido alterado é revertido.
 */
export function cleanContextualSegmentationNoise(input: {
  width: number;
  height: number;
  data: Uint8Array;
  L: Float32Array;
  a: Float32Array;
  b: Float32Array;
  regionIdMap: Int32Array;
  backgroundRgb: [number, number, number] | null;
  maxFragmentPixels?: number;
}): NoiseCleanupReport {
  const { width, height, data, L, a, b, regionIdMap, backgroundRgb } = input;
  const maxN = input.maxFragmentPixels ?? 80;
  const total = width * height;
  const before = new Int32Array(regionIdMap);
  const buckets = new Map<number, number[]>();
  const oversized = new Set<number>();

  for (let px = 0; px < total; px++) {
    const id = regionIdMap[px];
    if (id <= 0 || oversized.has(id)) continue;
    let list = buckets.get(id);
    if (!list) {
      list = [];
      buckets.set(id, list);
    }
    list.push(px);
    if (list.length > maxN) {
      oversized.add(id);
      buckets.delete(id);
    }
  }

  const report: NoiseCleanupReport = {
    classified: 0,
    removedFragments: 0,
    keptStructures: 0,
    keptDetails: 0,
    keptOpenings: 0,
    revertedPixels: 0,
    byClass: EMPTY_COUNTS(),
    protectedRegionIds: [],
  };
  const protectedPx = new Uint8Array(total);

  for (const [, pixels] of buckets) {
    if (pixels.length > maxN || pixels.length < 1) continue;
    const stats = measure(pixels, width, L, a, b);
    const kind = classify(stats, width, height, data, L, a, b, regionIdMap, backgroundRgb);
    report.classified++;
    report.byClass[kind]++;

    if (
      kind === 'real_structure' ||
      kind === 'legitimate_detail' ||
      kind === 'legitimate_opening'
    ) {
      for (const px of pixels) protectedPx[px] = 1;
      if (kind === 'real_structure') report.keptStructures++;
      else if (kind === 'legitimate_detail') report.keptDetails++;
      else report.keptOpenings++;
      if (kind !== 'legitimate_opening') report.protectedRegionIds.push(regionIdMap[pixels[0]]);
      if (kind === 'legitimate_opening') {
        for (const px of pixels) regionIdMap[px] = 0;
      }
      continue;
    }

    const target = absorptionTarget(stats, width, height, data, L, a, b, regionIdMap, backgroundRgb, kind);
    for (const px of pixels) regionIdMap[px] = target;
    report.removedFragments++;
  }

  for (let px = 0; px < total; px++) {
    if (protectedPx[px] && regionIdMap[px] !== before[px] && before[px] > 0) {
      const changedToBackground = regionIdMap[px] <= 0 && before[px] > 0;
      if (!changedToBackground) {
        regionIdMap[px] = before[px];
        report.revertedPixels++;
      }
    }
  }

  return report;
}

function measure(
  pixels: number[],
  width: number,
  L: Float32Array,
  a: Float32Array,
  b: Float32Array
): RegionStats {
  let sL = 0;
  let sA = 0;
  let sB = 0;
  let minX = width;
  let minY = 1e9;
  let maxX = 0;
  let maxY = 0;
  for (const px of pixels) {
    const x = px % width;
    const y = (px - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    sL += L[px];
    sA += a[px];
    sB += b[px];
  }
  const n = pixels.length;
  return {
    id: 0,
    pixels,
    meanL: sL / n,
    meanA: sA / n,
    meanB: sB / n,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function classify(
  stats: RegionStats,
  width: number,
  height: number,
  data: Uint8Array,
  L: Float32Array,
  a: Float32Array,
  b: Float32Array,
  regionIdMap: Int32Array,
  backgroundRgb: [number, number, number] | null
): NoiseComponentClass {
  const n = stats.pixels.length;
  const bw = stats.maxX - stats.minX + 1;
  const bh = stats.maxY - stats.minY + 1;
  const elongation = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
  const compactness = n / Math.max(1, bw * bh);

  const contacts = new Map<number, number>();
  let blendVotes = 0;
  let edgeSamples = 0;
  for (const px of stats.pixels) {
    const x = px % width;
    const y = (px - x) / width;
    const nbs = [
      x > 0 ? px - 1 : -1,
      x + 1 < width ? px + 1 : -1,
      y > 0 ? px - width : -1,
      y + 1 < height ? px + width : -1,
    ];
    const around: number[] = [];
    for (const nPx of nbs) {
      if (nPx < 0) continue;
      const nr = regionIdMap[nPx];
      if (nr === regionIdMap[px]) continue;
      contacts.set(nr, (contacts.get(nr) ?? 0) + 1);
      around.push(nPx);
    }
    if (around.length >= 2) {
      edgeSamples++;
      const p = px * 4;
      const a4 = around[0] * 4;
      const b4 = around[around.length - 1] * 4;
      const vx = data[a4] - data[b4];
      const vy = data[a4 + 1] - data[b4 + 1];
      const vz = data[a4 + 2] - data[b4 + 2];
      const denom = vx * vx + vy * vy + vz * vz;
      if (denom > 80) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((data[p] - data[b4]) * vx +
              (data[p + 1] - data[b4 + 1]) * vy +
              (data[p + 2] - data[b4 + 2]) * vz) /
              denom
          )
        );
        const res = Math.hypot(
          data[p] - (data[b4] + t * vx),
          data[p + 1] - (data[b4 + 1] + t * vy),
          data[p + 2] - (data[b4 + 2] + t * vz)
        );
        if (res <= 18) blendVotes++;
      }
    }
  }

  let fgNeighbor = 0;
  let fgCount = 0;
  for (const [id, count] of contacts) {
    if (id <= 0 || count <= fgCount) continue;
    fgNeighbor = id;
    fgCount = count;
  }

  const fgLab = fgNeighbor
    ? meanOfLabel(fgNeighbor, stats, width, height, L, a, b, regionIdMap)
    : null;
  const fgContrast = fgLab
    ? deltaEOklab(stats.meanL, stats.meanA, stats.meanB, fgLab[0], fgLab[1], fgLab[2])
    : 99;

  const bgDist = backgroundRgb
    ? averageBgDistance(stats.pixels, data, backgroundRgb)
    : 999;
  const enclosed = contacts.size === 1 && fgNeighbor > 0 && !touchesBorder(stats, width, height);

  if (enclosed && backgroundRgb && bgDist <= 14 && fgContrast >= 12) {
    return 'legitimate_opening';
  }
  if (edgeSamples >= 3 && blendVotes >= edgeSamples * 0.62 && n <= 48) {
    return 'antialiasing';
  }
  if (fgNeighbor && fgContrast < 8) return 'segmentation_noise';
  if (fgNeighbor && n <= 36 && compactness < 0.5 && fgContrast < 18) return 'compression_noise';
  if (elongation >= 2.6 && n >= 5 && fgContrast >= 9 && fgContrast < 80) return 'real_structure';
  if (!fgNeighbor && elongation >= 3 && n >= 6 && bgDist >= 20) return 'real_structure';
  if (compactness >= 0.4 && bgDist >= 18 && fgContrast >= 16) return 'legitimate_detail';
  if (fgNeighbor && fgContrast < 11 && elongation < 2.2) return 'tonal_transition';
  if (backgroundRgb && bgDist <= 14) return 'compression_noise';
  if (n <= 6) return 'reconstruction_artifact';
  if (fgContrast >= 14 && (elongation >= 2 || compactness >= 0.45)) return 'real_structure';
  return 'compression_noise';
}

function meanOfLabel(
  label: number,
  stats: RegionStats,
  width: number,
  height: number,
  L: Float32Array,
  a: Float32Array,
  b: Float32Array,
  regionIdMap: Int32Array
): [number, number, number] | null {
  if (label <= 0) return null;
  let sL = 0;
  let sA = 0;
  let sB = 0;
  let n = 0;
  for (const px of stats.pixels) {
    const nbs = [px - 1, px + 1, px - width, px + width];
    for (const nPx of nbs) {
      if (nPx < 0 || nPx >= width * height) continue;
      if (regionIdMap[nPx] !== label) continue;
      sL += L[nPx];
      sA += a[nPx];
      sB += b[nPx];
      n++;
      if (n >= 12) break;
    }
    if (n >= 12) break;
  }
  if (n === 0) return null;
  return [sL / n, sA / n, sB / n];
}

function averageBgDistance(
  pixels: number[],
  data: Uint8Array,
  bg: [number, number, number]
): number {
  let sum = 0;
  const step = Math.max(1, Math.floor(pixels.length / 16));
  let n = 0;
  for (let i = 0; i < pixels.length; i += step) {
    sum += chebyshevAt(data, pixels[i], bg);
    n++;
  }
  return n ? sum / n : 999;
}

function touchesBorder(stats: RegionStats, width: number, height: number): boolean {
  return stats.minX <= 1 || stats.minY <= 1 || stats.maxX >= width - 2 || stats.maxY >= height - 2;
}

function absorptionTarget(
  stats: RegionStats,
  width: number,
  height: number,
  data: Uint8Array,
  L: Float32Array,
  a: Float32Array,
  b: Float32Array,
  regionIdMap: Int32Array,
  backgroundRgb: [number, number, number] | null,
  kind: NoiseComponentClass
): number {
  const self = regionIdMap[stats.pixels[0]];
  const contacts = new Map<number, { n: number; l: number; a: number; b: number }>();
  for (const px of stats.pixels) {
    const nbs = [px - 1, px + 1, px - width, px + width];
    for (const nPx of nbs) {
      if (nPx < 0 || nPx >= width * height) continue;
      const nr = regionIdMap[nPx];
      if (nr === self) continue;
      const slot = contacts.get(nr) ?? { n: 0, l: 0, a: 0, b: 0 };
      slot.n++;
      if (nr > 0 && slot.n <= 8) {
        slot.l += L[nPx];
        slot.a += a[nPx];
        slot.b += b[nPx];
      }
      contacts.set(nr, slot);
    }
  }

  const bgDist = backgroundRgb ? averageBgDistance(stats.pixels, data, backgroundRgb) : 999;
  let best = 0;
  let bestScore = bgDist;
  for (const [id, slot] of contacts) {
    if (id <= 0) continue;
    const used = Math.max(1, Math.min(8, slot.n));
    const de = deltaEOklab(stats.meanL, stats.meanA, stats.meanB, slot.l / used, slot.a / used, slot.b / used);
    if (de < bestScore) {
      bestScore = de;
      best = id;
    }
  }

  if (
    (kind === 'compression_noise' || kind === 'reconstruction_artifact' || kind === 'antialiasing') &&
    backgroundRgb &&
    bgDist <= bestScore + 3
  ) {
    return 0;
  }
  return best;
}
