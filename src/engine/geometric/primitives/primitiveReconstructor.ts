import {
  boundaryError,
  geometricAcceptance,
  maskIoU,
  referenceError,
  sampleArc,
  sampleCircle,
  sampleEllipse,
  sampleLine,
  type ErrorStats,
  type Point2D,
} from '../contract/geometricContract';
import { isInsidePrimitive } from './browserSafeMaskRasterizer';
import { arcToSvgElement, fitCircularArcPrimitive, fitEllipticalArcPrimitive } from './arcFitter';
import { circleToSvgElement, fitCirclePrimitive } from './circleFitter';
import { compositeToSvgElement, fitCompositePrimitive } from './compositeFitter';
import { ellipseToSvgElement, fitEllipsePrimitive } from './ellipseFitter';
import { fitLineSegment, lineToSvgElement } from './lineFitter';
import {
  fitPolygonPrimitive,
  fitRoundedRectPrimitive,
  polygonToSvgElement,
  promotePolygonToRect,
  rectToSvgElement,
} from './polygonFitter';
import type {
  GeometricPrimitive,
  MaskValidationMetrics,
  PrimitiveReconstructionResult,
} from './types';

export interface MaskValidationInput {
  width: number;
  height: number;
  referenceMask: Uint8Array;
  minIoU?: number;
  minRecall?: number;
}

/**
 * Amostra pontos ao longo de uma primitiva reconstruída para validação métrica contra a borda original.
 */
export function samplePrimitiveBoundary(primitive: GeometricPrimitive): Point2D[] {
  switch (primitive.kind) {
    case 'line':
      return sampleLine(primitive.x1, primitive.y1, primitive.x2, primitive.y2, 1.5);
    case 'circle': {
      const pts = sampleCircle(primitive.cx, primitive.cy, primitive.r, 2);
      if (pts.length > 0) pts.push(pts[0]);
      return pts;
    }
    case 'ellipse': {
      const raw = sampleEllipse(primitive.cx, primitive.cy, primitive.rx, primitive.ry, 2);
      if (raw.length > 0) raw.push(raw[0]);
      if (Math.abs(primitive.rotationDeg) < 1e-3) return raw;
      const rad = (primitive.rotationDeg * Math.PI) / 180;
      const cosT = Math.cos(rad);
      const sinT = Math.sin(rad);
      return raw.map((p) => {
        const dx = p.x - primitive.cx;
        const dy = p.y - primitive.cy;
        return {
          x: primitive.cx + dx * cosT - dy * sinT,
          y: primitive.cy + dx * sinT + dy * cosT,
        };
      });
    }
    case 'arc': {
      const startDeg = (primitive.startAngleRad * 180) / Math.PI;
      const endDeg = (primitive.endAngleRad * 180) / Math.PI;
      if (Math.abs(primitive.rx - primitive.ry) < 0.05) {
        return sampleArc(primitive.cx, primitive.cy, primitive.rx, startDeg, endDeg, 2);
      }
      const rad = (primitive.rotationDeg * Math.PI) / 180;
      const cosT = Math.cos(rad);
      const sinT = Math.sin(rad);
      const pts: Point2D[] = [];
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const a =
          primitive.startAngleRad +
          ((primitive.endAngleRad - primitive.startAngleRad) * i) / steps;
        const lx = primitive.rx * Math.cos(a);
        const ly = primitive.ry * Math.sin(a);
        pts.push({
          x: primitive.cx + lx * cosT - ly * sinT,
          y: primitive.cy + lx * sinT + ly * cosT,
        });
      }
      return pts;
    }
    case 'polygon': {
      const pts: Point2D[] = [];
      const n = primitive.vertices.length;
      const count = primitive.closed ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const a = primitive.vertices[i];
        const b = primitive.vertices[(i + 1) % n];
        pts.push(...sampleLine(a.x, a.y, b.x, b.y, 1.5));
      }
      return pts;
    }
    case 'rect': {
      const r = primitive.rx ?? 0;
      const x0 = primitive.x;
      const y0 = primitive.y;
      const x1 = primitive.x + primitive.width;
      const y1 = primitive.y + primitive.height;
      const pts: Point2D[] = [];
      if (r > 0.05) {
        pts.push(...sampleLine(x0 + r, y0, x1 - r, y0, 1.5));
        pts.push(...sampleArc(x1 - r, y0 + r, r, -90, 0, 3));
        pts.push(...sampleLine(x1, y0 + r, x1, y1 - r, 1.5));
        pts.push(...sampleArc(x1 - r, y1 - r, r, 0, 90, 3));
        pts.push(...sampleLine(x1 - r, y1, x0 + r, y1, 1.5));
        pts.push(...sampleArc(x0 + r, y1 - r, r, 90, 180, 3));
        pts.push(...sampleLine(x0, y1 - r, x0, y0 + r, 1.5));
        pts.push(...sampleArc(x0 + r, y0 + r, r, 180, 270, 3));
      } else {
        pts.push(...sampleLine(x0, y0, x1, y0, 1.5));
        pts.push(...sampleLine(x1, y0, x1, y1, 1.5));
        pts.push(...sampleLine(x1, y1, x0, y1, 1.5));
        pts.push(...sampleLine(x0, y1, x0, y0, 1.5));
      }
      if (primitive.rotationDeg && Math.abs(primitive.rotationDeg) > 1e-3) {
        const cx = 0.5 * (x0 + x1);
        const cy = 0.5 * (y0 + y1);
        const rad = (primitive.rotationDeg * Math.PI) / 180;
        const cosT = Math.cos(rad);
        const sinT = Math.sin(rad);
        return pts.map((p) => {
          const dx = p.x - cx;
          const dy = p.y - cy;
          return {
            x: cx + dx * cosT - dy * sinT,
            y: cy + dx * sinT + dy * cosT,
          };
        });
      }
      return pts;
    }
    case 'composite': {
      const pts: Point2D[] = [];
      for (const seg of primitive.segments) {
        pts.push(...samplePrimitiveBoundary(seg));
      }
      return pts;
    }
  }
}

export function primitiveToSvgElement(
  primitive: GeometricPrimitive,
  attrs: { fill: string; stroke?: string; strokeWidth?: number }
): string {
  switch (primitive.kind) {
    case 'line':
      return lineToSvgElement(primitive, {
        stroke: attrs.stroke ?? attrs.fill,
        strokeWidth: attrs.strokeWidth ?? 1,
      });
    case 'circle':
      return circleToSvgElement(primitive, attrs);
    case 'ellipse':
      return ellipseToSvgElement(primitive, attrs);
    case 'rect':
      return rectToSvgElement(primitive, attrs);
    case 'polygon':
      return polygonToSvgElement(primitive, attrs);
    case 'arc':
      return arcToSvgElement(primitive, {
        stroke: attrs.stroke ?? attrs.fill,
        strokeWidth: attrs.strokeWidth ?? 1,
        fill: 'none',
      });
    case 'composite':
      return compositeToSvgElement(primitive, attrs);
  }
}

function validateAgainstMask(
  primitive: GeometricPrimitive,
  sampledBoundary: Point2D[],
  mask: MaskValidationInput,
  boundaryPoints?: Point2D[]
): MaskValidationMetrics {
  let x0 = 0;
  let y0 = 0;
  let cw = mask.width;
  let ch = mask.height;
  const pts = boundaryPoints && boundaryPoints.length > 0 ? boundaryPoints : sampledBoundary;
  if (pts.length > 0) {
    let minX = mask.width;
    let minY = mask.height;
    let maxX = 0;
    let maxY = 0;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    x0 = Math.max(0, Math.floor(minX) - 4);
    y0 = Math.max(0, Math.floor(minY) - 4);
    const x1 = Math.min(mask.width, Math.ceil(maxX) + 4);
    const y1 = Math.min(mask.height, Math.ceil(maxY) + 4);
    cw = Math.max(2, x1 - x0);
    ch = Math.max(2, y1 - y0);
  }
  const fullW = mask.width;
  return maskIoU(
    cw,
    ch,
    (x, y) => mask.referenceMask[(y + y0) * fullW + (x + x0)] === 1,
    (x, y) => isInsidePrimitive(x + x0 + 0.5, y + y0 + 0.5, primitive, sampledBoundary)
  );
}

/**
 * Avalia um contorno fechado subpixel e tenta reconstruí-lo como primitiva geométrica exata
 * (círculo, elipse, retângulo, retângulo arredondado, polígono ou combinação de retas e arcos).
 *
 * Princípio da Etapa 2:
 * - Guiado exclusivamente pela evidência da borda subpixel e pela máscara original.
 * - Rejeita imediatamente qualquer candidato que viole os limites do contrato da Etapa 1
 *   ou que altere a silhueta (IoU < 0.96).
 * - Nunca força formas orgânicas a virarem círculos ou elipses.
 */
export function reconstructClosedContourPrimitive(
  boundaryPoints: Point2D[],
  fillHex: string,
  maskValidation?: MaskValidationInput
): PrimitiveReconstructionResult {
  const emptyErr: ErrorStats = {
    maxPx: Number.POSITIVE_INFINITY,
    meanPx: Number.POSITIVE_INFINITY,
    hausdorffPx: Number.POSITIVE_INFINITY,
    samples: 0,
  };

  if (boundaryPoints.length < 4) {
    return {
      primitive: null,
      accepted: false,
      reason: 'Contorno insuficiente para ajuste de primitiva.',
      error: emptyErr,
      svgElement: null,
    };
  }

  const closedRef =
    boundaryPoints[0].x === boundaryPoints[boundaryPoints.length - 1].x &&
    boundaryPoints[0].y === boundaryPoints[boundaryPoints.length - 1].y
      ? boundaryPoints
      : [...boundaryPoints, boundaryPoints[0]];

  const candidates: Array<{
    primitive: GeometricPrimitive;
    hausdorffLimit: number;
    label: string;
  }> = [];

  const circle = fitCirclePrimitive(boundaryPoints);
  if (circle) {
    candidates.push({
      primitive: circle,
      hausdorffLimit: geometricAcceptance.circle.hausdorffPx,
      label: 'circle',
    });
  }

  if (!circle) {
    const ellipse = fitEllipsePrimitive(boundaryPoints);
    if (ellipse) {
      candidates.push({
        primitive: ellipse,
        hausdorffLimit: geometricAcceptance.ellipse.hausdorffPx,
        label: 'ellipse',
      });
    }
  }

  const polygon = fitPolygonPrimitive(boundaryPoints);
  const straightRect = polygon ? promotePolygonToRect(polygon) : null;
  if (straightRect) {
    candidates.push({
      primitive: straightRect,
      hausdorffLimit: geometricAcceptance.line.hausdorffPx + 0.15,
      label: 'rect',
    });
  }

  if (!circle && !straightRect) {
    const roundedRect = fitRoundedRectPrimitive(boundaryPoints);
    if (roundedRect) {
      candidates.push({
        primitive: roundedRect,
        hausdorffLimit: geometricAcceptance.arc.maxPx + 0.1,
        label: 'rounded-rect',
      });
    }
  }

  if (polygon && !straightRect) {
    candidates.push({
      primitive: polygon,
      hausdorffLimit: geometricAcceptance.line.hausdorffPx + 0.15,
      label: 'polygon',
    });
  }

  if (!circle && !polygon) {
    const composite = fitCompositePrimitive(boundaryPoints);
    if (composite) {
      candidates.push({
        primitive: composite,
        hausdorffLimit: geometricAcceptance.arc.maxPx + 0.15,
        label: 'composite',
      });
    }
  }

  let bestRejectedReason =
    'Nenhuma primitiva geométrica atendeu ao contrato dentro dos limites de erro.';
  let bestRejectedError = emptyErr;
  let bestRejectedMask: MaskValidationMetrics | undefined;

  for (const cand of candidates) {
    const sampled = samplePrimitiveBoundary(cand.primitive);
    const err =
      cand.primitive.kind === 'polygon' || cand.primitive.kind === 'rect'
        ? (() => {
            // Em cantos agudos reais, a rasterização antialiasada reduz a cobertura da ponta para < 50%,
            // truncando o contorno iso=0.5 enquanto a interseção exata das arestas recupera o vértice real.
            // Portanto medimos o erro de todos os pontos da borda raster até o polígono (forward)
            // e dos pontos reconstruídos fora do raio de ponta aguda até a borda raster (backward).
            const fwd = referenceError(closedRef, [sampled]);
            const vertices =
              cand.primitive.kind === 'polygon'
                ? cand.primitive.vertices
                : [
                    { x: cand.primitive.x, y: cand.primitive.y },
                    { x: cand.primitive.x + cand.primitive.width, y: cand.primitive.y },
                    {
                      x: cand.primitive.x + cand.primitive.width,
                      y: cand.primitive.y + cand.primitive.height,
                    },
                    { x: cand.primitive.x, y: cand.primitive.y + cand.primitive.height },
                  ];
            const nonTipSampled = sampled.filter((pt) =>
              vertices.every((v) => Math.hypot(pt.x - v.x, pt.y - v.y) > 2.8)
            );
            const bwd =
              nonTipSampled.length > 0
                ? referenceError(nonTipSampled, [closedRef])
                : fwd;
            const maxPx = Math.max(fwd.maxPx, bwd.maxPx);
            const meanPx = Number((0.5 * (fwd.meanPx + bwd.meanPx)).toFixed(3));
            return {
              maxPx,
              meanPx,
              hausdorffPx: maxPx,
              samples: fwd.samples + bwd.samples,
            };
          })()
        : boundaryError(closedRef, [sampled]);
    const svgElement = primitiveToSvgElement(cand.primitive, { fill: fillHex });

    if (err.hausdorffPx > cand.hausdorffLimit) {
      if (err.hausdorffPx < bestRejectedError.hausdorffPx) {
        bestRejectedError = err;
        bestRejectedReason = `Candidato ${cand.label} rejeitado: Hausdorff ${err.hausdorffPx.toFixed(3)} px > limite ${cand.hausdorffLimit} px.`;
      }
      continue;
    }

    let maskMetrics: MaskValidationMetrics | undefined;
    if (maskValidation) {
      maskMetrics = validateAgainstMask(cand.primitive, sampled, maskValidation, boundaryPoints);
      const minIoU = maskValidation.minIoU ?? geometricAcceptance.coverage.iouSolid;
      const minRecall = maskValidation.minRecall ?? geometricAcceptance.coverage.recallDetail;
      if (maskMetrics.iou < minIoU || maskMetrics.recall < minRecall) {
        if (err.hausdorffPx < bestRejectedError.hausdorffPx) {
          bestRejectedError = err;
          bestRejectedMask = maskMetrics;
          bestRejectedReason = `Candidato ${cand.label} rejeitado por silhueta: IoU ${(maskMetrics.iou * 100).toFixed(2)}% (mín ${(minIoU * 100).toFixed(0)}%), recall ${(maskMetrics.recall * 100).toFixed(2)}%.`;
        }
        continue;
      }
    }

    return {
      primitive: cand.primitive,
      accepted: true,
      reason: `Primitiva ${cand.label} aceita dentro do contrato.`,
      error: err,
      maskMetrics,
      svgElement,
    };
  }

  return {
    primitive: null,
    accepted: false,
    reason: bestRejectedReason,
    error: bestRejectedError,
    maskMetrics: bestRejectedMask,
    svgElement: null,
  };
}

/**
 * Avalia uma cadeia aberta subpixel (ex.: eixo central ou segmento isolado)
 * e tenta ajustar reta, arco circular ou arco elíptico preservando extremos.
 */
export function reconstructOpenChainPrimitive(
  chainPoints: Point2D[],
  strokeHex: string,
  strokeWidth = 1
): PrimitiveReconstructionResult {
  const emptyErr: ErrorStats = {
    maxPx: Number.POSITIVE_INFINITY,
    meanPx: Number.POSITIVE_INFINITY,
    hausdorffPx: Number.POSITIVE_INFINITY,
    samples: 0,
  };

  if (chainPoints.length < 2) {
    return {
      primitive: null,
      accepted: false,
      reason: 'Cadeia aberta insuficiente.',
      error: emptyErr,
      svgElement: null,
    };
  }

  const line = fitLineSegment(chainPoints, { preserveEndpoints: true });
  if (line) {
    const sampled = samplePrimitiveBoundary(line);
    const err = boundaryError(chainPoints, [sampled]);
    if (err.hausdorffPx <= geometricAcceptance.line.hausdorffPx) {
      return {
        primitive: line,
        accepted: true,
        reason: 'Primitiva line aceita dentro do contrato.',
        error: err,
        svgElement: lineToSvgElement(line, { stroke: strokeHex, strokeWidth }),
      };
    }
  }

  const circArc = fitCircularArcPrimitive(chainPoints);
  if (circArc) {
    const sampled = samplePrimitiveBoundary(circArc);
    const err = boundaryError(chainPoints, [sampled]);
    if (err.hausdorffPx <= geometricAcceptance.arc.maxPx + 0.1) {
      return {
        primitive: circArc,
        accepted: true,
        reason: 'Primitiva arc circular aceita dentro do contrato.',
        error: err,
        svgElement: arcToSvgElement(circArc, { stroke: strokeHex, strokeWidth }),
      };
    }
  }

  const ellipArc = fitEllipticalArcPrimitive(chainPoints);
  if (ellipArc) {
    const sampled = samplePrimitiveBoundary(ellipArc);
    const err = boundaryError(chainPoints, [sampled]);
    if (err.hausdorffPx <= geometricAcceptance.arc.maxPx + 0.1) {
      return {
        primitive: ellipArc,
        accepted: true,
        reason: 'Primitiva arc elíptico aceita dentro do contrato.',
        error: err,
        svgElement: arcToSvgElement(ellipArc, { stroke: strokeHex, strokeWidth }),
      };
    }
  }

  return {
    primitive: null,
    accepted: false,
    reason:
      'Cadeia aberta não corresponde a reta ou arco dentro do contrato (preservada como orgânica).',
    error: emptyErr,
    svgElement: null,
  };
}
