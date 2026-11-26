import type { RawRgbaImage } from '../../types';
import type { Point2D } from '../contract/geometricContract';
import { reconstructClosedContourPrimitive } from '../primitives/primitiveReconstructor';
import { extractSubpixelLoopsFromField } from '../primitives/subpixelBoundaryExtractor';
import { fmtNum } from '../primitives/types';
import { fitOrganicCurve } from '../curves/organicFitter';
import { classifyAppearance, collectSamples, type AppearanceModel, type HighlightLayer } from './tonalField';

export interface AppearanceObject {
  id: number;
  role: 'object' | 'shadow';
  kind: AppearanceModel['kind'] | 'shadow';
  geometry: string;
  painted: string;
  defs: string;
  opacity: number;
  stopCount: number;
}

export interface AppearanceReconstruction {
  width: number;
  height: number;
  objects: AppearanceObject[];
  svg: string;
  geometrySvg: string;
  structuralPaths: number;
}

function bgOf(image: RawRgbaImage): [number, number, number] {
  const { width, height, data } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) return;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [255, 255, 255];
}

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function components(mask: Uint8Array, width: number, height: number, minPixels: number): number[][] {
  const labels = new Int32Array(mask.length);
  const found: number[][] = [];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = found.length + 1;
    const pixels: number[] = [];
    while (head < tail) {
      const index = queue[head++];
      pixels.push(index);
      const x = index % width;
      const y = (index - x) / width;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const next = ny * width + nx;
        if (!mask[next] || labels[next]) return;
        labels[next] = found.length + 1;
        queue[tail++] = next;
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
    if (pixels.length >= minPixels) found.push(pixels);
  }
  return found;
}

function interior(mask: Uint8Array, width: number, height: number): Uint8Array {
  const next = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      if (mask[index] && mask[index - 1] && mask[index + 1] && mask[index - width] && mask[index + width]) next[index] = 1;
    }
  }
  return next.some((value) => value) ? next : mask;
}

function geometryOf(mask: Uint8Array, width: number, height: number): string {
  const field = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) field[i] = mask[i] ? 1 : 0;
  const loops = extractSubpixelLoopsFromField(field, width, height, 0.5).sort((a, b) => b.areaPx - a.areaPx);
  const outer = loops[0];
  if (!outer) return '';
  const holes = loops.filter((loop) => loop !== outer && loop.areaPx >= 8 && loop.areaPx < outer.areaPx * 0.8);
  const outerFit = reconstructClosedContourPrimitive(outer.points, '#000');
  if (holes.length === 0 && outerFit.accepted && outerFit.svgElement) {
    return outerFit.svgElement.replace(/\sfill="[^"]*"/, '');
  }
  const loopsD = [outer, ...holes].map((loop) => fitOrganicCurve(loop.points, { closed: true }).path).filter(Boolean);
  return `<path d="${loopsD.join(' ')}" fill-rule="evenodd"/>`;
}

function geometryKey(svg: string): string {
  return svg
    .replace(/\sfill="[^"]*"/g, '')
    .replace(/\sopacity="[^"]*"/g, '')
    .replace(/\sclip-path="[^"]*"/g, '')
    .replace(/\sfilter="[^"]*"/g, '')
    .replace(/\sid="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function withPaint(geometry: string, fill: string, opacity: number, extra = ''): string {
  const opacityAttr = opacity < 0.985 ? ` opacity="${fmtNum(opacity)}"` : '';
  if (geometry.startsWith('<path')) return geometry.replace('<path', `<path fill="${fill}"${opacityAttr}${extra}`);
  if (geometry.startsWith('<rect')) return geometry.replace('<rect', `<rect fill="${fill}"${opacityAttr}${extra}`);
  if (geometry.startsWith('<circle')) return geometry.replace('<circle', `<circle fill="${fill}"${opacityAttr}${extra}`);
  if (geometry.startsWith('<ellipse')) return geometry.replace('<ellipse', `<ellipse fill="${fill}"${opacityAttr}${extra}`);
  return geometry.replace(/^(<\w+)/, `$1 fill="${fill}"${opacityAttr}${extra}`);
}

function defsFor(id: string, appearance: AppearanceModel, highlight: HighlightLayer | null): string {
  const parts: string[] = [];
  if (appearance.kind === 'linear') {
    const stops = appearance.stops
      .map((stop) => `<stop offset="${fmtNum(stop.offset * 100)}%" stop-color="${stop.color}"/>`)
      .join('');
    parts.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmtNum(appearance.x1)}" y1="${fmtNum(appearance.y1)}" x2="${fmtNum(appearance.x2)}" y2="${fmtNum(appearance.y2)}">${stops}</linearGradient>`
    );
  } else if (appearance.kind === 'radial') {
    const stops = appearance.stops
      .map((stop) => `<stop offset="${fmtNum(stop.offset * 100)}%" stop-color="${stop.color}"/>`)
      .join('');
    parts.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmtNum(appearance.cx)}" cy="${fmtNum(appearance.cy)}" r="${fmtNum(appearance.r)}">${stops}</radialGradient>`
    );
  }
  if (highlight) {
    parts.push(
      `<radialGradient id="${id}-brilho" gradientUnits="userSpaceOnUse" cx="${fmtNum(highlight.cx)}" cy="${fmtNum(highlight.cy)}" r="${fmtNum(highlight.r)}"><stop offset="0%" stop-color="#ffffff" stop-opacity="${fmtNum(highlight.opacity)}"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`
    );
  }
  return parts.join('');
}

function fillOf(id: string, appearance: AppearanceModel): string {
  if (appearance.kind === 'solid') return appearance.color;
  return `url(#${id})`;
}

/**
 * Pinta cada silhueta sem alterar seu contorno.
 * Rampa contínua vira gradiente. Brilho e sombra entram como camadas presas à mesma geometria.
 */
export function reconstructAppearance(image: RawRgbaImage): AppearanceReconstruction {
  const { width, height, data } = image;
  const bg = bgOf(image);
  const foreground = new Uint8Array(width * height);
  const chromatic = new Uint8Array(width * height);
  const achromatic = new Uint8Array(width * height);
  for (let i = 0; i < foreground.length; i++) {
    if (data[i * 4 + 3] < 16) continue;
    const dist = Math.hypot(data[i * 4] - bg[0], data[i * 4 + 1] - bg[1], data[i * 4 + 2] - bg[2]);
    if (dist < 26 && data[i * 4 + 3] > 230) continue;
    foreground[i] = 1;
    if (chroma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= 18) chromatic[i] = 1;
    else achromatic[i] = 1;
  }
  const chromaticParts = components(chromatic, width, height, 20);
  const objectMasks = chromaticParts.length ? chromaticParts : components(foreground, width, height, 20);
  const achromaticParts = chromaticParts.length ? components(achromatic, width, height, 20) : [];

  const objects: AppearanceObject[] = [];
  const defs: string[] = [];
  const body: string[] = [];
  const geometryBody: string[] = [];

  objectMasks.forEach((pixels, index) => {
    const mask = new Uint8Array(width * height);
    for (const pixel of pixels) mask[pixel] = 1;
    const geometry = geometryOf(mask, width, height);
    const samples = collectSamples(image, interior(mask, width, height), Math.max(1, Math.floor(pixels.length / 2500)));
    const classified = classifyAppearance(samples);
    const id = `aparencia-${index + 1}`;
    defs.push(defsFor(id, classified.appearance, classified.highlight));
    const painted = withPaint(geometry, fillOf(id, classified.appearance), classified.appearance.opacity);
    const highlight = classified.highlight
      ? withPaint(geometry, `url(#${id}-brilho)`, 1, ` clip-path="url(#recorte-${index + 1})"`)
      : '';
    if (classified.highlight) {
      const clipSource = geometry.replace(/^\s*<(\w+)/, '<$1').replace(/\sfill="[^"]*"/g, '');
      defs.push(`<clipPath id="recorte-${index + 1}">${clipSource}</clipPath>`);
    }
    body.push(`<g id="objeto-${index + 1}">${painted}${highlight}</g>`);
    geometryBody.push(geometry);
    objects.push({
      id: index + 1,
      role: 'object',
      kind: classified.appearance.kind,
      geometry: geometryKey(geometry),
      painted: geometryKey(painted),
      defs: defsFor(id, classified.appearance, classified.highlight),
      opacity: classified.appearance.opacity,
      stopCount: classified.appearance.kind === 'solid' ? 1 : classified.appearance.stops.length,
    });
  });

  achromaticParts.forEach((pixels, index) => {
    const mask = new Uint8Array(width * height);
    for (const pixel of pixels) mask[pixel] = 1;
    const geometry = geometryOf(mask, width, height);
    const samples = collectSamples(image, mask, 2);
    const color = samples.reduce((sum, sample) => sum + sample.luminance, 0) / (samples.length || 1);
    const opacity = Math.max(0.12, Math.min(0.6, 1 - color / 255));
    const painted = withPaint(geometry, '#111111', opacity, ` filter="url(#sombra-suave)"`);
    body.push(`<g id="sombra-${index + 1}">${painted}</g>`);
    geometryBody.push(geometry);
    objects.push({
      id: 100 + index,
      role: 'shadow',
      kind: 'shadow',
      geometry: geometryKey(geometry),
      painted: geometryKey(painted),
      defs: '',
      opacity,
      stopCount: 1,
    });
  });

  if (achromaticParts.length) {
    defs.push(`<filter id="sombra-suave"><feGaussianBlur stdDeviation="1.2"/></filter>`);
  }
  const geometrySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${geometryBody.join('')}</svg>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
  return {
    width,
    height,
    objects,
    svg,
    geometrySvg,
    structuralPaths: objects.length,
  };
}

export function sameGeometry(before: string, after: string): boolean {
  return geometryKey(before) === geometryKey(after);
}

export type { Point2D };
