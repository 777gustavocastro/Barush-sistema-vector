import type { RawRgbaImage } from '../../types';
import {
  buildCoverageFieldFromImage,
  extractSubpixelLoopsFromField,
} from './subpixelBoundaryExtractor';
import {
  reconstructClosedContourPrimitive,
  samplePrimitiveBoundary,
} from './primitiveReconstructor';
import type { GeometricPrimitive, PrimitiveReconstructionResult } from './types';
import type { Point2D } from '../contract/geometricContract';

export interface SceneComponentPrimitiveReport {
  componentId: number;
  pixelCount: number;
  fillHex: string;
  holeCount: number;
  outerResult: PrimitiveReconstructionResult;
  holeResults: PrimitiveReconstructionResult[];
  sampledOuterChain: Point2D[];
}

export interface ScenePrimitiveReconstruction {
  width: number;
  height: number;
  bgHex: string;
  components: SceneComponentPrimitiveReport[];
  acceptedPrimitives: number;
  rejectedOrganic: number;
  svg: string;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

function estimateBorderBgRgb(image: RawRgbaImage): [number, number, number] {
  const { width, height, data } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const add = (x: number, y: number) => {
    const i4 = (y * width + x) * 4;
    if (data[i4 + 3] < 128) return;
    r += data[i4];
    g += data[i4 + 1];
    b += data[i4 + 2];
    count++;
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }
  if (count === 0) return [255, 255, 255];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

/**
 * Segmenta a imagem em componentes conexos de foreground (separando do fundo) e aplica
 * o motor de reconstrução por primitivas geométricas em cada componente com borda subpixel.
 *
 * Componentes que possuem furos ou formas orgânicas têm seus laços avaliados individualmente
 * e nunca são achatados por uma primitiva que destrua a silhueta.
 */
export function reconstructScenePrimitives(
  image: RawRgbaImage,
  options?: {
    bgTolerance?: number;
    minComponentPixels?: number;
  }
): ScenePrimitiveReconstruction {
  const { width, height, data } = image;
  const bg = estimateBorderBgRgb(image);
  const bgHex = rgbToHex(bg[0], bg[1], bg[2]);
  const bgTol = options?.bgTolerance ?? 26;
  const minPixels = options?.minComponentPixels ?? 24;

  // Máscara de foreground (pixels suficientemente distantes do fundo)
  const fgMask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const i4 = i * 4;
    if (data[i4 + 3] < 128) continue;
    const dist = Math.hypot(data[i4] - bg[0], data[i4 + 1] - bg[1], data[i4 + 2] - bg[2]);
    if (dist > bgTol) fgMask[i] = 1;
  }

  // Componentes conexos 4-vizinhos
  const labels = new Int32Array(width * height);
  let nextLabel = 0;
  const compPixels: number[][] = [];
  const queue = new Int32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    if (!fgMask[i] || labels[i] !== 0) continue;
    nextLabel++;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    labels[i] = nextLabel;
    const pixels: number[] = [];

    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      const x = idx % width;
      const y = (idx - x) / width;
      if (x > 0 && fgMask[idx - 1] && !labels[idx - 1]) {
        labels[idx - 1] = nextLabel;
        queue[tail++] = idx - 1;
      }
      if (x + 1 < width && fgMask[idx + 1] && !labels[idx + 1]) {
        labels[idx + 1] = nextLabel;
        queue[tail++] = idx + 1;
      }
      if (y > 0 && fgMask[idx - width] && !labels[idx - width]) {
        labels[idx - width] = nextLabel;
        queue[tail++] = idx - width;
      }
      if (y + 1 < height && fgMask[idx + width] && !labels[idx + width]) {
        labels[idx + width] = nextLabel;
        queue[tail++] = idx + width;
      }
    }

    if (pixels.length >= minPixels) {
      compPixels.push(pixels);
    }
  }

  const components: SceneComponentPrimitiveReport[] = [];
  const svgElements: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${bgHex}"/>`,
  ];
  let acceptedPrimitives = 0;
  let rejectedOrganic = 0;

  for (let cIdx = 0; cIdx < compPixels.length; cIdx++) {
    const pixels = compPixels[cIdx];

    // Cor representativa do núcleo interior (evita diluição pelos pixels antialiasados de borda)
    const compMask = new Uint8Array(width * height);
    for (const idx of pixels) compMask[idx] = 1;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let interiorCount = 0;
    for (const idx of pixels) {
      const x = idx % width;
      const y = (idx - x) / width;
      if (
        x > 0 &&
        x + 1 < width &&
        y > 0 &&
        y + 1 < height &&
        compMask[idx - 1] &&
        compMask[idx + 1] &&
        compMask[idx - width] &&
        compMask[idx + width]
      ) {
        const i4 = idx * 4;
        rSum += data[i4];
        gSum += data[i4 + 1];
        bSum += data[i4 + 2];
        interiorCount++;
      }
    }
    if (interiorCount === 0) {
      for (const idx of pixels) {
        const i4 = idx * 4;
        rSum += data[i4];
        gSum += data[i4 + 1];
        bSum += data[i4 + 2];
      }
      interiorCount = pixels.length;
    }
    const fgRgb: [number, number, number] = [
      Math.round(rSum / interiorCount),
      Math.round(gSum / interiorCount),
      Math.round(bSum / interiorCount),
    ];
    const fillHex = rgbToHex(fgRgb[0], fgRgb[1], fgRgb[2]);

    // Campo contínuo subpixel restrito à vizinhança imediata do componente
    const fullField = buildCoverageFieldFromImage(image, bg, fgRgb);
    const localField = new Float32Array(width * height);
    const refMaskIso50 = new Uint8Array(width * height);
    for (const idx of pixels) {
      const x = idx % width;
      const y = (idx - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          const cov = fullField[nIdx];
          localField[nIdx] = cov;
          if (cov >= 0.5) refMaskIso50[nIdx] = 1;
        }
      }
    }

    const loops = extractSubpixelLoopsFromField(localField, width, height, 0.5);
    const outerLoop = loops.find((l) => !l.isHole) ?? loops[0];
    if (!outerLoop) continue;

    const holeLoops = loops.filter((l) => l !== outerLoop && l.isHole && l.areaPx >= 4);

    // Se há furos, a máscara de validação do contorno externo deve ter os furos preenchidos
    // para validar a silhueta externa separadamente e validar cada furo em seguida
    const outerResult = reconstructClosedContourPrimitive(
      outerLoop.points,
      fillHex,
      holeLoops.length === 0
        ? {
            width,
            height,
            referenceMask: refMaskIso50,
          }
        : undefined
    );

    const holeResults: PrimitiveReconstructionResult[] = [];
    for (const hLoop of holeLoops) {
      holeResults.push(reconstructClosedContourPrimitive(hLoop.points, bgHex));
    }

    let sampledOuterChain: Point2D[] = [];
    if (outerResult.accepted && outerResult.primitive && outerResult.svgElement) {
      acceptedPrimitives++;
      svgElements.push(outerResult.svgElement);
      sampledOuterChain = samplePrimitiveBoundary(outerResult.primitive);
      for (const hRes of holeResults) {
        if (hRes.accepted && hRes.svgElement) {
          svgElements.push(hRes.svgElement);
        }
      }
    } else {
      rejectedOrganic++;
    }

    components.push({
      componentId: cIdx + 1,
      pixelCount: pixels.length,
      fillHex,
      holeCount: holeLoops.length,
      outerResult,
      holeResults,
      sampledOuterChain,
    });
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgElements.join('')}</svg>`;

  return {
    width,
    height,
    bgHex,
    components,
    acceptedPrimitives,
    rejectedOrganic,
    svg,
  };
}

export function describePrimitive(p: GeometricPrimitive | null): string {
  if (!p) return 'rejeitada (orgânica/complexa)';
  switch (p.kind) {
    case 'line':
      return `line (${p.x1.toFixed(2)},${p.y1.toFixed(2)})→(${p.x2.toFixed(2)},${p.y2.toFixed(2)})`;
    case 'rect':
      return p.rx
        ? `rect arredondado ${p.width.toFixed(2)}×${p.height.toFixed(2)} rx=${p.rx.toFixed(2)}`
        : p.rotationDeg
          ? `rect rotacionado ${p.width.toFixed(2)}×${p.height.toFixed(2)} rot=${p.rotationDeg.toFixed(2)}°`
          : `rect ${p.width.toFixed(2)}×${p.height.toFixed(2)}`;
    case 'circle':
      return `circle cx=${p.cx.toFixed(2)} cy=${p.cy.toFixed(2)} r=${p.r.toFixed(2)}`;
    case 'ellipse':
      return `ellipse cx=${p.cx.toFixed(2)} cy=${p.cy.toFixed(2)} rx=${p.rx.toFixed(2)} ry=${p.ry.toFixed(2)} rot=${p.rotationDeg.toFixed(2)}°`;
    case 'arc':
      return `arc rx=${p.rx.toFixed(2)} ry=${p.ry.toFixed(2)}`;
    case 'polygon':
      return `polygon (${p.vertices.length} vértices)`;
    case 'composite':
      return `composite (${p.segments.length} segmentos: ${p.segments.map((s) => s.kind).join('+')})`;
  }
}
