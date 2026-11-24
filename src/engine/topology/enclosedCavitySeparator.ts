import { deltaEOklab } from '../color/perceptualColor';
import type { OpenCvImageDecomposition, SegmentedSubRegion } from '../opencv/opencvSegmenter';

const BACKGROUND_MATCH_DE = 8;

/**
 * Separa cavidades da cor do fundo que a segmentação colou na borda.
 * O miolo vira vazio (rótulo 0) e o caminho do objeto ganha o furo.
 * Uma cor diferente cercada por outra permanece região própria.
 * Não alarga o contorno e não apaga um detalhe fino sem núcleo.
 */
export function separateEnclosedBackgroundCavities(decomposition: OpenCvImageDecomposition): void {
  const background = decomposition.backgroundOklab;
  const subs = decomposition.objects.flatMap((obj) => obj.subRegions);
  const backgroundLike = new Set<number>();
  for (const sub of subs) {
    if (isProtected(sub)) continue;
    if (background && deltaEOklab(sub.meanOklab[0], sub.meanOklab[1], sub.meanOklab[2], background[0], background[1], background[2]) <= BACKGROUND_MATCH_DE) {
      backgroundLike.add(sub.id);
    } else if (!decomposition.hasUniformOpaqueBackground && sub.meanA < 12) {
      backgroundLike.add(sub.id);
    }
  }
  if (backgroundLike.size === 0) return;

  const map = decomposition.regionIdMap;
  const objects = decomposition.objectLabelMap;
  const width = decomposition.width;
  const height = decomposition.height;

  for (const id of backgroundLike) {
    peelExteriorSliver(map, objects, width, height, id);
  }

  const reached = new Uint8Array(map.length);
  const stack: number[] = [];
  const consider = (index: number) => {
    if (index < 0 || index >= map.length || reached[index]) return;
    const id = map[index];
    if (id > 0 && !backgroundLike.has(id)) return;
    reached[index] = 1;
    stack.push(index);
  };
  for (let x = 0; x < width; x++) {
    consider(x);
    consider((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    consider(y * width);
    consider(y * width + width - 1);
  }
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) consider(index - 1);
    if (x + 1 < width) consider(index + 1);
    if (y > 0) consider(index - width);
    if (y + 1 < height) consider(index + width);
  }

  for (let index = 0; index < map.length; index++) {
    const id = map[index];
    if (!backgroundLike.has(id) || reached[index]) continue;
    map[index] = 0;
    objects[index] = 0;
  }

  for (const sub of subs) {
    if (!backgroundLike.has(sub.id)) continue;
    let kept = 0;
    for (let i = 0; i < sub.pixels.length; i++) {
      if (map[sub.pixels[i]] === sub.id) sub.pixels[kept++] = sub.pixels[i];
    }
    if (kept !== sub.pixels.length) sub.pixels = sub.pixels.subarray(0, kept);
    sub.pixelCount = kept;
    sub.touchesExteriorBg = kept > 0;
    sub.enclosedByRegionId = 0;
  }
}

function isProtected(sub: SegmentedSubRegion): boolean {
  return sub.isSemiTransparent || sub.isSoftShadow || sub.nature === 'shadow' || sub.nature === 'translucent';
}

function peelExteriorSliver(
  map: Int32Array,
  objects: Int32Array,
  width: number,
  height: number,
  id: number
): void {
  const core = new Uint8Array(map.length);
  let coreCount = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const index = row + x;
      if (map[index] !== id) continue;
      if (map[index - 1] === id && map[index + 1] === id && map[index - width] === id && map[index + width] === id) {
        core[index] = 1;
        coreCount++;
      }
    }
  }
  if (coreCount < 8) return;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (map[index] !== id || core[index]) continue;
      let nearCore = false;
      for (let dy = -1; dy <= 1 && !nearCore; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (core[ny * width + nx]) {
            nearCore = true;
            break;
          }
        }
      }
      if (!nearCore) {
        map[index] = 0;
        objects[index] = 0;
      }
    }
  }
}
