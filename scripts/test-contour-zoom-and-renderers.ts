import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { chromium } from 'playwright-core';
import {
  computeQualityComparisonFromBuffers,
  evaluateContourThicknessConsistency,
  inspectAndSanitizeSvgContours,
  runVectorizationFromBytes,
  validateSvgStructure,
  type RawRgbaImage,
  type VectorizationParameters,
} from '../src/engine/index';

const execFileAsync = promisify(execFile);

const DEFAULT_PARAMS: VectorizationParameters = {
  profile: 'auto',
  engine: 'auto',
  autoTune: true,
  colorCount: 256,
  detailPrecision: 96,
  curveSmoothness: 68,
  pathSimplification: 6,
  noiseRemoval: 0,
  contourSensitivity: 86,
  optimizeSvg: true,
  reconstructGradients: true,
  enhanceTypography: true,
  subpixelUpscale: true,
};

interface AnalyticalTestCase {
  id: string;
  title: string;
  width: number;
  height: number;
  masterSvg: string;
  format?: 'png' | 'jpeg';
  jpegQuality?: number;
  additiveNoiseAmp?: number;
  minSsim100: number;
  maxDeltaE00: number;
  maxChamferPx: number;
  testMultiZoom800?: boolean;
  testMultiRenderer?: boolean;
  zoomCropBox?: { x: number; y: number; w: number; h: number };
}

function renderSvgWithResvgAtSize(
  svgMarkup: string,
  targetWidth: number,
  targetHeight: number,
  bgRgb?: [number, number, number]
): RawRgbaImage {
  const resvg = new Resvg(svgMarkup, {
    fitTo: { mode: 'width', value: targetWidth },
    ...(bgRgb ? { background: `rgb(${bgRgb[0]}, ${bgRgb[1]}, ${bgRgb[2]})` } : {}),
  });
  const rendered = resvg.render();
  const src = rendered.pixels;
  const out = new Uint8Array(rendered.width * rendered.height * 4);
  // Desmultiplica tiny-skia premultiplied RGBA -> straight RGBA
  for (let i = 0; i < out.length; i += 4) {
    const a = src[i + 3];
    if (a === 0) continue;
    if (a === 255) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = 255;
    } else {
      out[i] = Math.min(255, Math.round((src[i] * 255) / a));
      out[i + 1] = Math.min(255, Math.round((src[i + 1] * 255) / a));
      out[i + 2] = Math.min(255, Math.round((src[i + 2] * 255) / a));
      out[i + 3] = a;
    }
  }
  if (rendered.width !== targetWidth || rendered.height !== targetHeight) {
    throw new Error(
      `Dimensão inesperada no Resvg: ${rendered.width}x${rendered.height} vs ${targetWidth}x${targetHeight}`
    );
  }
  return { width: targetWidth, height: targetHeight, data: out };
}

async function encodeTestInputBytes(tc: AnalyticalTestCase): Promise<{
  bytes: Uint8Array;
  decodedInput: RawRgbaImage;
  cleanGroundTruth100: RawRgbaImage;
}> {
  const cleanGroundTruth100 = renderSvgWithResvgAtSize(tc.masterSvg, tc.width, tc.height);
  const workingBuf = new Uint8Array(cleanGroundTruth100.data);

  if (tc.additiveNoiseAmp && tc.additiveNoiseAmp > 0) {
    // Gerador determinístico LCG para reprodutibilidade exata de regressão
    let seed = 133742;
    const amp = tc.additiveNoiseAmp;
    for (let i = 0; i < workingBuf.length; i += 4) {
      if (workingBuf[i + 3] < 200) continue;
      for (let c = 0; c < 3; c++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const n = ((seed / 0xffffffff) * 2 - 1) * amp;
        workingBuf[i + c] = Math.max(0, Math.min(255, Math.round(workingBuf[i + c] + n)));
      }
    }
  }

  let encodedBuf: Buffer;
  if (tc.format === 'jpeg') {
    encodedBuf = await sharp(Buffer.from(workingBuf), {
      raw: { width: tc.width, height: tc.height, channels: 4 },
    })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: tc.jpegQuality ?? 74, chromaSubsampling: '4:2:0' })
      .toBuffer();
  } else {
    encodedBuf = await sharp(Buffer.from(workingBuf), {
      raw: { width: tc.width, height: tc.height, channels: 4 },
    })
      .png()
      .toBuffer();
  }

  const { data: decData, info } = await sharp(encodedBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    bytes: new Uint8Array(encodedBuf),
    decodedInput: {
      width: info.width,
      height: info.height,
      data: new Uint8Array(decData),
    },
    cleanGroundTruth100,
  };
}

function build16MandatoryContourCases(): AnalyticalTestCase[] {
  return [
    {
      id: '01-letras-contorno-preto',
      title: '01. Letras com Contorno Preto (Zero Invasão no Branco/Amarelo)',
      width: 340,
      height: 180,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="180" viewBox="0 0 340 180">
        <rect width="340" height="180" fill="#f8fafc"/>
        <!-- Letra A, O, B estilizadas com contorno preto uniforme de 4px e preenchimento claro -->
        <g stroke="#0f172a" stroke-width="8" stroke-linejoin="round" paint-order="stroke fill" fill="#facc15">
          <path d="M 34 142 L 66 38 L 98 142 L 80 142 L 73 116 L 59 116 L 52 142 Z M 62 98 L 70 98 L 66 76 Z" fill-rule="evenodd"/>
          <path d="M 160 38 C 192 38 210 60 210 90 C 210 120 192 142 160 142 C 128 142 110 120 110 90 C 110 60 128 38 160 38 Z M 160 58 C 141 58 131 71 131 90 C 131 109 141 122 160 122 C 179 122 189 109 189 90 C 189 71 179 58 160 58 Z" fill-rule="evenodd"/>
          <path d="M 232 38 L 280 38 C 299 38 310 49 310 65 C 310 77 302 85 292 88 C 305 91 314 101 314 115 C 314 132 301 142 281 142 L 232 142 Z M 252 56 L 252 80 L 276 80 C 285 80 290 75 290 68 C 290 61 285 56 276 56 Z M 252 98 L 252 124 L 279 124 C 289 124 294 119 294 111 C 294 103 289 98 279 98 Z" fill-rule="evenodd"/>
        </g>
      </svg>`,
      minSsim100: 98.2,
      maxDeltaE00: 0.75,
      maxChamferPx: 0.12,
      testMultiZoom800: true,
      testMultiRenderer: true,
      zoomCropBox: { x: 105, y: 32, w: 110, h: 116 },
    },
    {
      id: '02-letras-contorno-branco',
      title: '02. Letras com Contorno Branco sobre Fundo Escuro',
      width: 320,
      height: 170,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="170" viewBox="0 0 320 170">
        <rect width="320" height="170" fill="#0f172a"/>
        <g stroke="#ffffff" stroke-width="9" stroke-linejoin="round" paint-order="stroke fill" fill="#ec4899">
          <path d="M 35 36 L 58 36 L 80 108 L 102 36 L 125 36 L 91 134 L 69 134 Z"/>
          <path d="M 146 36 L 214 36 L 214 55 L 168 55 L 168 75 L 208 75 L 208 94 L 168 94 L 168 115 L 216 115 L 216 134 L 146 134 Z"/>
          <path d="M 230 36 L 302 36 L 302 56 L 277 56 L 277 134 L 255 134 L 255 56 L 230 56 Z"/>
        </g>
      </svg>`,
      minSsim100: 98.4,
      maxDeltaE00: 0.65,
      maxChamferPx: 0.12,
    },
    {
      id: '03-letras-contorno-duplo',
      title: '03. Letras com Contornos Duplos Concêntricos',
      width: 320,
      height: 180,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
        <rect width="320" height="180" fill="#e2e8f0"/>
        <!-- Contorno externo azul-marinho (18px) + contorno interno branco (10px) + preenchimento laranja -->
        <g fill="none" stroke="#0f172a" stroke-width="18" stroke-linejoin="round">
          <path d="M 48 44 L 98 44 C 120 44 134 57 134 77 C 134 97 120 110 98 110 L 72 110 L 72 140 L 48 140 Z M 72 64 L 72 90 L 95 90 C 105 90 111 85 111 77 C 111 69 105 64 95 64 Z"/>
          <circle cx="222" cy="92" r="46"/>
          <circle cx="222" cy="92" r="20"/>
        </g>
        <g fill="none" stroke="#ffffff" stroke-width="10" stroke-linejoin="round">
          <path d="M 48 44 L 98 44 C 120 44 134 57 134 77 C 134 97 120 110 98 110 L 72 110 L 72 140 L 48 140 Z M 72 64 L 72 90 L 95 90 C 105 90 111 85 111 77 C 111 69 105 64 95 64 Z"/>
          <circle cx="222" cy="92" r="46"/>
          <circle cx="222" cy="92" r="20"/>
        </g>
        <path fill="#f97316" fill-rule="evenodd" d="M 48 44 L 98 44 C 120 44 134 57 134 77 C 134 97 120 110 98 110 L 72 110 L 72 140 L 48 140 Z M 72 64 L 72 90 L 95 90 C 105 90 111 85 111 77 C 111 69 105 64 95 64 Z"/>
        <path fill="#f97316" fill-rule="evenodd" d="M 222 46 A 46 46 0 1 1 221.99 46 Z M 222 72 A 20 20 0 1 0 222.01 72 Z"/>
      </svg>`,
      minSsim100: 98.0,
      maxDeltaE00: 0.85,
      maxChamferPx: 0.14,
      testMultiZoom800: true,
      zoomCropBox: { x: 162, y: 34, w: 120, h: 116 },
    },
    {
      id: '04-numeros-precisao',
      title: '04. Números Geométricos e Contadores Internos (208)',
      width: 300,
      height: 160,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160" viewBox="0 0 300 160">
        <rect width="300" height="160" fill="#ffffff"/>
        <!-- 2 -->
        <path fill="#1d4ed8" d="M 32 58 C 32 36 50 24 72 24 C 95 24 110 38 110 57 C 110 73 99 85 78 102 L 58 118 L 112 118 L 112 136 L 30 136 L 30 120 L 67 89 C 83 75 90 67 90 57 C 90 47 82 41 71 41 C 59 41 51 48 50 60 Z"/>
        <!-- 0 -->
        <path fill="#0f766e" fill-rule="evenodd" d="M 156 24 C 184 24 198 46 198 80 C 198 114 184 136 156 136 C 128 136 114 114 114 80 C 114 46 128 24 156 24 Z M 156 42 C 140 42 134 56 134 80 C 134 104 140 118 156 118 C 172 118 178 104 178 80 C 178 56 172 42 156 42 Z"/>
        <!-- 8 -->
        <path fill="#7c3aed" fill-rule="evenodd" d="M 248 24 C 270 24 284 36 284 52 C 284 64 277 73 266 77 C 279 82 288 92 288 106 C 288 125 272 136 248 136 C 224 136 208 125 208 106 C 208 92 217 82 230 77 C 219 73 212 64 212 52 C 212 36 226 24 248 24 Z M 248 40 C 236 40 230 45 230 54 C 230 62 237 68 248 68 C 259 68 266 62 266 54 C 266 45 260 40 248 40 Z M 248 86 C 235 86 227 93 227 104 C 227 114 235 120 248 120 C 261 120 269 114 269 104 C 269 93 261 86 248 86 Z"/>
      </svg>`,
      minSsim100: 98.8,
      maxDeltaE00: 0.45,
      maxChamferPx: 0.1,
    },
    {
      id: '05-simbolos-pontas-e-curvas',
      title: '05. Símbolos Técnicos (Pontas Agudas + Arcos Suaves)',
      width: 280,
      height: 200,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="200" viewBox="0 0 280 200">
        <rect width="280" height="200" fill="#f8fafc"/>
        <!-- Estrela de 5 pontas agudas -->
        <polygon fill="#eab308" stroke="#0f172a" stroke-width="4" stroke-linejoin="miter" points="78,26 93,68 138,68 102,94 115,138 78,112 41,138 54,94 18,68 63,68"/>
        <!-- Símbolo de verificação dentro de anel -->
        <path fill="#10b981" fill-rule="evenodd" d="M 206 34 A 62 62 0 1 1 205.99 34 Z M 206 50 A 46 46 0 1 0 206.01 50 Z"/>
        <path fill="#059669" d="M 180 96 L 197 113 L 234 74 L 245 85 L 197 135 L 169 107 Z"/>
      </svg>`,
      minSsim100: 98.5,
      maxDeltaE00: 0.55,
      maxChamferPx: 0.1,
      testMultiZoom800: true,
      zoomCropBox: { x: 16, y: 22, w: 126, h: 122 },
    },
    {
      id: '06-icone-cantos-arredondados',
      title: '06. Ícone de Interface (Cantos Arredondados Transparentes + Símbolo)',
      width: 240,
      height: 240,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
        <rect x="20" y="20" width="200" height="200" rx="44" fill="#4f46e5"/>
        <path fill="#ffffff" d="M 74 126 L 106 158 L 170 86 L 154 72 L 106 126 L 88 108 Z"/>
        <circle cx="166" cy="162" r="16" fill="#38bdf8"/>
      </svg>`,
      minSsim100: 99.3,
      maxDeltaE00: 0.35,
      maxChamferPx: 0.08,
      testMultiRenderer: true,
    },
    {
      id: '07-formas-circulares-e-elipses',
      title: '07. Formas Circulares, Anéis e Elipse Inclinada (Zero Facetas)',
      width: 300,
      height: 220,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220" viewBox="0 0 300 220">
        <rect width="300" height="220" fill="#ffffff"/>
        <circle cx="84" cy="110" r="64" fill="#0ea5e9"/>
        <circle cx="84" cy="110" r="38" fill="#ffffff"/>
        <circle cx="84" cy="110" r="18" fill="#0284c7"/>
        <ellipse cx="218" cy="110" rx="62" ry="34" transform="rotate(-28 218 110)" fill="#8b5cf6"/>
        <ellipse cx="218" cy="110" rx="30" ry="15" transform="rotate(-28 218 110)" fill="#ede9fe"/>
      </svg>`,
      minSsim100: 99.4,
      maxDeltaE00: 0.3,
      maxChamferPx: 0.06,
      testMultiZoom800: true,
      testMultiRenderer: true,
      zoomCropBox: { x: 18, y: 44, w: 134, h: 134 },
    },
    {
      id: '08-formas-geometricas-angulos-rasos',
      title: '08. Formas Geométricas (Cantos 90° + Inclinações Rasas 1:8 sem Escada)',
      width: 320,
      height: 220,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
        <rect width="320" height="220" fill="#f1f5f9"/>
        <!-- Retângulo ortogonal puro -->
        <rect x="24" y="28" width="112" height="76" fill="#0f172a"/>
        <rect x="44" y="48" width="72" height="36" fill="#38bdf8"/>
        <!-- Rampa rasa 1:8 (onde abordagens ingênuas criam degraus de escada!) -->
        <polygon points="24,140 296,174 296,198 24,164" fill="#ef4444"/>
        <!-- Hexágono e Triângulo agudo -->
        <polygon points="224,24 276,48 276,98 224,122 172,98 172,48" fill="#10b981"/>
        <polygon points="224,46 254,94 194,94" fill="#ffffff"/>
      </svg>`,
      minSsim100: 99.3,
      maxDeltaE00: 0.35,
      maxChamferPx: 0.07,
      testMultiZoom800: true,
      zoomCropBox: { x: 40, y: 134, w: 180, h: 66 },
    },
    {
      id: '09-curvas-complexas-inflexoes',
      title: '09. Curvas Complexas com Inflexões Suaves e Concavidades',
      width: 320,
      height: 220,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
        <rect width="320" height="220" fill="#ffffff"/>
        <path fill="#6366f1" d="M 28 156 C 68 32 138 32 164 110 C 190 188 252 188 292 64 L 292 108 C 254 214 176 214 148 130 C 120 46 68 68 28 188 Z"/>
        <path fill="#ec4899" d="M 64 56 C 96 20 144 48 118 88 C 92 128 40 92 64 56 Z"/>
      </svg>`,
      minSsim100: 99.2,
      maxDeltaE00: 0.35,
      maxChamferPx: 0.08,
    },
    {
      id: '10-linhas-finas-continuas',
      title: '10. Linhas Finas Contínuas (2px–3px de Espessura Uniforme)',
      width: 300,
      height: 200,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
        <rect width="300" height="200" fill="#ffffff"/>
        <g fill="none" stroke="#0f172a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="86" cy="100" r="56"/>
          <circle cx="86" cy="100" r="28"/>
          <path d="M 168 46 L 268 46 L 218 102 L 272 156 L 168 156"/>
          <path d="M 168 102 C 195 72 235 132 268 98"/>
        </g>
      </svg>`,
      minSsim100: 98.4,
      maxDeltaE00: 0.55,
      maxChamferPx: 0.1,
    },
    {
      id: '11-logo-multicor-fronteiras-compartilhadas',
      title: '11. Logo Multicor com Junções Triplas/Quádruplas e Fronteiras Compartilhadas',
      width: 280,
      height: 240,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="240" viewBox="0 0 280 240">
        <rect width="280" height="240" fill="#f8fafc"/>
        <path fill="#ef4444" d="M 140 24 L 236 80 L 140 120 Z"/>
        <path fill="#f59e0b" d="M 236 80 L 236 168 L 140 120 Z"/>
        <path fill="#10b981" d="M 236 168 L 140 216 L 140 120 Z"/>
        <path fill="#06b6d4" d="M 140 216 L 44 168 L 140 120 Z"/>
        <path fill="#3b82f6" d="M 44 168 L 44 80 L 140 120 Z"/>
        <path fill="#8b5cf6" d="M 44 80 L 140 24 L 140 120 Z"/>
        <circle cx="140" cy="120" r="28" fill="#ffffff" stroke="#0f172a" stroke-width="5"/>
      </svg>`,
      minSsim100: 98.8,
      maxDeltaE00: 0.5,
      maxChamferPx: 0.09,
      testMultiZoom800: true,
      testMultiRenderer: true,
      zoomCropBox: { x: 96, y: 76, w: 88, h: 88 },
    },
    {
      id: '12-personagem-ilustracao-contornos',
      title: '12. Ilustração / Personagem com Contorno Preto, Olhos e Brilhos',
      width: 280,
      height: 260,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="260" viewBox="0 0 280 260">
        <rect width="280" height="260" fill="#e0f2fe"/>
        <circle cx="140" cy="134" r="88" fill="#fde047" stroke="#0f172a" stroke-width="6"/>
        <circle cx="106" cy="112" r="20" fill="#ffffff" stroke="#0f172a" stroke-width="4"/>
        <circle cx="174" cy="112" r="20" fill="#ffffff" stroke="#0f172a" stroke-width="4"/>
        <circle cx="110" cy="112" r="9" fill="#0f172a"/>
        <circle cx="178" cy="112" r="9" fill="#0f172a"/>
        <circle cx="113" cy="108" r="3.2" fill="#ffffff"/>
        <circle cx="181" cy="108" r="3.2" fill="#ffffff"/>
        <ellipse cx="78" cy="144" rx="14" ry="9" fill="#fb7185"/>
        <ellipse cx="202" cy="144" rx="14" ry="9" fill="#fb7185"/>
        <path d="M 98 162 C 116 190 164 190 182 162" fill="none" stroke="#0f172a" stroke-width="6" stroke-linecap="round"/>
      </svg>`,
      minSsim100: 98.5,
      maxDeltaE00: 0.65,
      maxChamferPx: 0.1,
    },
    {
      id: '13-desenho-monocromatico-caligrafico',
      title: '13. Desenho Monocromático com Espessura Variável',
      width: 280,
      height: 220,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="220" viewBox="0 0 280 220">
        <rect width="280" height="220" fill="#ffffff"/>
        <path fill="#111827" d="M 36 168 C 58 64 142 30 228 62 C 244 68 242 84 224 80 C 154 62 86 88 62 174 C 58 186 32 182 36 168 Z"/>
        <path fill="#111827" d="M 94 146 C 132 114 184 114 236 154 C 244 160 236 172 226 166 C 182 134 138 134 104 160 Z"/>
      </svg>`,
      minSsim100: 99.1,
      maxDeltaE00: 0.45,
      maxChamferPx: 0.08,
    },
    {
      id: '14-bordas-com-gradientes',
      title: '14. Escudo com Borda em Gradiente Metálico e Interior Degradê',
      width: 260,
      height: 260,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260">
        <defs>
          <linearGradient id="rim" x1="30" y1="20" x2="230" y2="240" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#fde047"/>
            <stop offset="50%" stop-color="#eab308"/>
            <stop offset="100%" stop-color="#a16207"/>
          </linearGradient>
          <linearGradient id="core" x1="130" y1="46" x2="130" y2="216" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#3b82f6"/>
            <stop offset="100%" stop-color="#1e1b4b"/>
          </linearGradient>
        </defs>
        <rect width="260" height="260" fill="#0f172a"/>
        <path fill="url(#rim)" d="M 130 22 L 222 54 L 222 130 C 222 182 182 220 130 238 C 78 220 38 182 38 130 L 38 54 Z"/>
        <path fill="url(#core)" d="M 130 44 L 200 68 L 200 128 C 200 169 169 200 130 215 C 91 200 60 169 60 128 L 60 68 Z"/>
      </svg>`,
      minSsim100: 98.6,
      maxDeltaE00: 0.85,
      maxChamferPx: 0.1,
    },
    {
      id: '15-elementos-transparentes-sobrepostos',
      title: '15. Elementos Transparentes e Semitransparentes Sobrepostos',
      width: 260,
      height: 240,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="240" viewBox="0 0 260 240">
        <circle cx="104" cy="116" r="66" fill="#06b6d4" fill-opacity="0.72"/>
        <circle cx="158" cy="116" r="66" fill="#ec4899" fill-opacity="0.68"/>
        <circle cx="131" cy="76" r="24" fill="#facc15"/>
      </svg>`,
      minSsim100: 99.0,
      maxDeltaE00: 0.45,
      maxChamferPx: 0.08,
    },
    {
      id: '16-formas-pequenos-furos-internos',
      title: '16. Engrenagem / Matriz com Múltiplos Pequenos Furos Internos (evenodd)',
      width: 260,
      height: 260,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260">
        <path fill="#334155" fill-rule="evenodd" d="
          M 130 28 A 102 102 0 1 1 129.99 28 Z
          M 130 94 A 36 36 0 1 0 130.01 94 Z
          M 130 46 A 10 10 0 1 0 130.01 46 Z
          M 130 194 A 10 10 0 1 0 130.01 194 Z
          M 56 120 A 10 10 0 1 0 56.01 120 Z
          M 204 120 A 10 10 0 1 0 204.01 120 Z
          M 78 68 A 7 7 0 1 0 78.01 68 Z
          M 182 68 A 7 7 0 1 0 182.01 68 Z
          M 78 172 A 7 7 0 1 0 78.01 172 Z
          M 182 172 A 7 7 0 1 0 182.01 172 Z
        "/>
      </svg>`,
      minSsim100: 99.0,
      maxDeltaE00: 0.4,
      maxChamferPx: 0.08,
    },
  ];
}

function buildDirtyAndMultiResStressCases(): AnalyticalTestCase[] {
  return [
    {
      id: 'stress-jpeg-q72-contorno-preto',
      title: 'Stress A: Compressão JPEG (Q=72) com Mosquito Noise em Letras Contornadas',
      width: 320,
      height: 170,
      format: 'jpeg',
      jpegQuality: 72,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="170" viewBox="0 0 320 170">
        <rect width="320" height="170" fill="#ffffff"/>
        <circle cx="88" cy="85" r="54" fill="#38bdf8" stroke="#0f172a" stroke-width="7"/>
        <circle cx="88" cy="85" r="22" fill="#ffffff" stroke="#0f172a" stroke-width="6"/>
        <polygon points="184,34 286,34 256,136 164,136" fill="#facc15" stroke="#0f172a" stroke-width="7" stroke-linejoin="round"/>
      </svg>`,
      minSsim100: 96.5,
      maxDeltaE00: 1.45,
      maxChamferPx: 0.22,
    },
    {
      id: 'stress-ruido-sensor-curvas',
      title: 'Stress B: Ruído Aditivo (±8 RGB) + Antialiasing em Círculos e Pontas',
      width: 280,
      height: 200,
      additiveNoiseAmp: 8,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="200" viewBox="0 0 280 200">
        <rect width="280" height="200" fill="#f8fafc"/>
        <circle cx="86" cy="100" r="56" fill="#ef4444"/>
        <circle cx="86" cy="100" r="26" fill="#f8fafc"/>
        <polygon points="204,32 256,162 152,162" fill="#2563eb"/>
      </svg>`,
      minSsim100: 96.0,
      maxDeltaE00: 1.5,
      maxChamferPx: 0.2,
    },
    {
      id: 'stress-baixa-resolucao-160x120',
      title: 'Stress C: Baixa Resolução (160×120) Escalada para 800% Vetorial',
      width: 160,
      height: 120,
      masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">
        <rect width="160" height="120" fill="#ffffff"/>
        <circle cx="52" cy="60" r="38" fill="#6366f1"/>
        <circle cx="52" cy="60" r="18" fill="#ffffff"/>
        <polygon points="118,22 148,98 88,98" fill="#10b981"/>
      </svg>`,
      minSsim100: 98.2,
      maxDeltaE00: 0.65,
      maxChamferPx: 0.14,
      testMultiZoom800: true,
      zoomCropBox: { x: 12, y: 20, w: 80, h: 80 },
    },
  ];
}

async function renderSvgWithSharpLibrsvg(
  svgMarkup: string,
  width: number,
  height: number
): Promise<RawRgbaImage> {
  const { data, info } = await sharp(Buffer.from(svgMarkup))
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

async function renderSvgWithInkscape(
  svgMarkup: string,
  width: number,
  height: number,
  tmpDir: string,
  tag: string
): Promise<{ rendered: RawRgbaImage; selectableObjectIds: number }> {
  const svgPath = path.join(tmpDir, `${tag}.svg`);
  const pngPath = path.join(tmpDir, `${tag}-ink.png`);
  await fs.writeFile(svgPath, svgMarkup, 'utf8');

  const { stdout: queryOut } = await execFileAsync('inkscape', ['--query-all', svgPath]);
  const selectableObjectIds = queryOut
    .trim()
    .split('\n')
    .filter((line) => line.includes(',')).length;

  await execFileAsync('inkscape', [
    svgPath,
    '--export-type=png',
    `--export-filename=${pngPath}`,
    `--export-width=${width}`,
    `--export-height=${height}`,
  ]);

  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    rendered: { width: info.width, height: info.height, data: new Uint8Array(data) },
    selectableObjectIds,
  };
}

async function renderSvgWithChromium(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  svgMarkup: string,
  width: number,
  height: number
): Promise<RawRgbaImage> {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(
      `<!DOCTYPE html><html><head><style>
        html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: transparent; }
        svg { width: ${width}px !important; height: ${height}px !important; display: block; }
      </style></head><body>${svgMarkup}</body></html>`,
      { waitUntil: 'load' }
    );
    const pngBuf = await page.screenshot({ omitBackground: true, type: 'png' });
    const { data, info } = await sharp(pngBuf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log(
    '=== AUDITORIA DEFINITIVA DE CONTORNOS, MULTI-ZOOM (25%..800%) E MULTI-RENDERIZADOR ===\n'
  );

  // 0. Teste unitário do saneador de strokes e remoção de non-scaling-stroke
  {
    const dirtyStrokeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <g vector-effect="non-scaling-stroke">
        <path id="p1" fill="none" stroke="#000000" stroke-width="3" stroke-miterlimit="25" vector-effect="non-scaling-stroke" d="M 10 80 L 50 12 L 50.01 12.01 L 70 46 L 90 80"/>
        <path id="p1-dup" fill="none" stroke="#000000" stroke-width="3" stroke-miterlimit="25" vector-effect="non-scaling-stroke" d="M 10 80 L 50 12 L 90 80"/>
      </g>
    </svg>`;
    const { svg: cleaned, summary } = inspectAndSanitizeSvgContours(dirtyStrokeSvg);
    assert(
      !/non-scaling-stroke/i.test(cleaned),
      'Falha: non-scaling-stroke deveria ter sido removido dos elementos da arte!'
    );
    assert(summary.nonScalingStrokesStripped >= 2);
    assert(summary.microSegmentsRemoved >= 1);
    assert(summary.collinearMergedCount >= 1);
    assert(summary.duplicatePathsRemoved >= 1);
    const val = validateSvgStructure(cleaned);
    assert(val.valid, `SVG saneado inválido: ${val.errors.join(', ')}`);
    console.log(
      `✔ Saneador Geométrico & Strokes: ${summary.duplicatePathsRemoved} duplicatas removidas, ` +
        `${summary.microSegmentsRemoved} micro-segmentos, ${summary.collinearMergedCount} colineares fundidos, ` +
        `${summary.nonScalingStrokesStripped} non-scaling-stroke eliminados.\n`
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'barush-contours-zoom-'));
  const browser = await chromium.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const ZOOM_SCALES = [0.25, 0.5, 1.0, 1.5, 2.0, 4.0, 8.0] as const;
  const mandatoryCases = build16MandatoryContourCases();
  const stressCases = buildDirtyAndMultiResStressCases();
  const allCases = [...mandatoryCases, ...stressCases];

  const zoomCropVisualTiles: Array<{
    title: string;
    rasterNearestPng: Buffer;
    vec800Png: Buffer;
    gt800Png: Buffer;
  }> = [];

  try {
    const failures: string[] = [];
    const check = (cond: boolean, msg: string) => {
      if (!cond) failures.push(msg);
    };

    console.log('--- PARTE A: 16 CATEGORIAS OBRIGATÓRIAS + TESTES COM RUÍDO E JPEG ---');
    for (const tc of allCases) {
      const { bytes, decodedInput, cleanGroundTruth100 } = await encodeTestInputBytes(tc);
      const hintName = `${tc.id}.${tc.format === 'jpeg' ? 'jpg' : 'png'}`;

      const params: VectorizationParameters =
        tc.additiveNoiseAmp || tc.format === 'jpeg'
          ? { ...DEFAULT_PARAMS, noiseRemoval: 28 }
          : DEFAULT_PARAMS;

      const res = await runVectorizationFromBytes(bytes, params, hintName);

      // 1. Validação estrutural estrita (Zero Raster + Zero non-scaling-stroke + IDs íntegros)
      check(res.validation.valid, `[${tc.id}] SVG inválido: ${res.validation.errors.join('; ')}`);
      check(res.validation.hasEmbeddedRaster === false, `[${tc.id}] Raster proibido!`);
      check(!/non-scaling-stroke/i.test(res.svg), `[${tc.id}] non-scaling-stroke proibido na arte!`);

      // 2. Fidelidade em 100% contra a geometria limpa de referência
      const hasOpaqueTl = cleanGroundTruth100.data[3] >= 250;
      const bgForRender: [number, number, number] | undefined = hasOpaqueTl
        ? [
            cleanGroundTruth100.data[0],
            cleanGroundTruth100.data[1],
            cleanGroundTruth100.data[2],
          ]
        : undefined;
      const vec100 = renderSvgWithResvgAtSize(res.svg, tc.width, tc.height, bgForRender);
      const q100 = computeQualityComparisonFromBuffers(cleanGroundTruth100, vec100);
      const thickness = evaluateContourThicknessConsistency(
        decodedInput,
        vec100,
        undefined,
        hasOpaqueTl,
        bgForRender ?? null
      );

      check(
        q100.ssimPct >= tc.minSsim100,
        `[${tc.id}] SSIM 100% abaixo do esperado: ${q100.ssimPct}% < ${tc.minSsim100}%`
      );
      check(
        (q100.meanDeltaE2000 ?? 99) <= tc.maxDeltaE00,
        `[${tc.id}] ΔE₀₀ acima do esperado: ${q100.meanDeltaE2000} > ${tc.maxDeltaE00}`
      );
      check(
        (q100.chamferDistancePx ?? 99) <= tc.maxChamferPx,
        `[${tc.id}] Chamfer acima do esperado: ${q100.chamferDistancePx}px > ${tc.maxChamferPx}px`
      );
      check(
        thickness.thicknessConsistencyPct >= 86,
        `[${tc.id}] Espessura inconsistente: ${thickness.thicknessConsistencyPct}%`
      );

      let zoomSummary = '';
      // 3. Estabilidade Vetorial em Múltiplos Níveis de Zoom: 25%, 50%, 100%, 150%, 200%, 400% e 800%!
      if (tc.testMultiZoom800) {
        const scaleSsims: string[] = [];
        for (const z of ZOOM_SCALES) {
          const zw = Math.max(16, Math.round(tc.width * z));
          const zh = Math.max(16, Math.round(tc.height * z));
          const gtZ = renderSvgWithResvgAtSize(tc.masterSvg, zw, zh);
          const vecZ = renderSvgWithResvgAtSize(res.svg, zw, zh);
          const qZ = computeQualityComparisonFromBuffers(gtZ, vecZ);

          // Em miniatura extrema 25% (85x45px, traços sub-pixel < 1px), janelas SSIM 8x8 têm sensibilidade de fase maior;
          // em 100%..800% (ampliação vetorial real!), exige alta fidelidade contínua!
          const minZoomSsim = z < 0.5 ? 93.5 : z < 1.0 ? 96.5 : z >= 4 ? 96.5 : 97.5;
          check(
            qZ.ssimPct >= minZoomSsim,
            `[${tc.id}] Falha de estabilidade no zoom ${Math.round(z * 100)}%: SSIM=${qZ.ssimPct}% < ${minZoomSsim}%`
          );
          scaleSsims.push(`${Math.round(z * 100)}%:${qZ.ssimPct}%`);

          if (z === 8.0 && tc.zoomCropBox) {
            const cb = tc.zoomCropBox;
            const cropSize = 220;
            const rasterCrop = await sharp(Buffer.from(decodedInput.data), {
              raw: { width: decodedInput.width, height: decodedInput.height, channels: 4 },
            })
              .extract({ left: cb.x, top: cb.y, width: cb.w, height: cb.h })
              .flatten({ background: '#f8fafc' })
              .resize(cropSize, cropSize, { kernel: sharp.kernel.nearest })
              .png()
              .toBuffer();

            const vec800Crop = await sharp(Buffer.from(vecZ.data), {
              raw: { width: zw, height: zh, channels: 4 },
            })
              .extract({
                left: cb.x * 8,
                top: cb.y * 8,
                width: cb.w * 8,
                height: cb.h * 8,
              })
              .flatten({ background: '#f8fafc' })
              .resize(cropSize, cropSize, { fit: 'fill' })
              .png()
              .toBuffer();

            const gt800Crop = await sharp(Buffer.from(gtZ.data), {
              raw: { width: zw, height: zh, channels: 4 },
            })
              .extract({
                left: cb.x * 8,
                top: cb.y * 8,
                width: cb.w * 8,
                height: cb.h * 8,
              })
              .flatten({ background: '#f8fafc' })
              .resize(cropSize, cropSize, { fit: 'fill' })
              .png()
              .toBuffer();

            zoomCropVisualTiles.push({
              title: tc.title,
              rasterNearestPng: rasterCrop,
              vec800Png: vec800Crop,
              gt800Png: gt800Crop,
            });
          }
        }
        zoomSummary = `\n    Zoom [25%..800%]: ${scaleSsims.join(' | ')}`;
      }

      let rendererSummary = '';
      // 4. Consistência Multi-Renderizador: Resvg vs Librsvg+Cairo vs Inkscape 1.2.2 vs Google Chrome (Blink/Skia)
      if (tc.testMultiRenderer) {
        const librsvgImg = await renderSvgWithSharpLibrsvg(res.svg, tc.width, tc.height);
        const inkRes = await renderSvgWithInkscape(res.svg, tc.width, tc.height, tmpDir, tc.id);
        const chromeImg = await renderSvgWithChromium(browser, res.svg, tc.width, tc.height);

        const qChromeVsResvg = computeQualityComparisonFromBuffers(vec100, chromeImg);
        const qInkVsResvg = computeQualityComparisonFromBuffers(vec100, inkRes.rendered);
        const qCairoVsResvg = computeQualityComparisonFromBuffers(vec100, librsvgImg);
        const qChromeVsInk = computeQualityComparisonFromBuffers(chromeImg, inkRes.rendered);

        check(
          inkRes.selectableObjectIds >= 2,
          `[${tc.id}] Inkscape não reconheceu objetos editáveis!`
        );
        check(
          qChromeVsResvg.ssimPct >= 98.4 &&
            qInkVsResvg.ssimPct >= 98.4 &&
            qCairoVsResvg.ssimPct >= 98.4 &&
            qChromeVsInk.ssimPct >= 98.4,
          `[${tc.id}] Divergência entre renderizadores! Chrome=${qChromeVsResvg.ssimPct}%, Inkscape=${qInkVsResvg.ssimPct}%, Librsvg=${qCairoVsResvg.ssimPct}%`
        );

        rendererSummary =
          `\n    Multi-Renderizador: Chrome×Resvg=${qChromeVsResvg.ssimPct}% | Inkscape×Resvg=${qInkVsResvg.ssimPct}% ` +
          `| Librsvg/Cairo×Resvg=${qCairoVsResvg.ssimPct}% | Chrome×Inkscape=${qChromeVsInk.ssimPct}% (Inkscape IDs=${inkRes.selectableObjectIds})`;
      }

      console.log(
        `✓ ${tc.title} [${res.engineUsed}]\n` +
          `    SSIM=${q100.ssimPct}% | ΔE00=${q100.meanDeltaE2000} | Chamfer=${q100.chamferDistancePx}px | ` +
          `HausdorffP99=${q100.hausdorffP99Px}px | Espessura=${thickness.thicknessConsistencyPct}% | Caminhos=${res.validation.pathCount}` +
          zoomSummary +
          rendererSummary
      );
    }

    if (failures.length > 0) {
      console.error('\n--- FALHAS DETECTADAS ---');
      for (const f of failures) console.error('  ✗', f);
      assert.equal(failures.length, 0, `${failures.length} falha(s) na auditoria de contornos.`);
    }

    // 5. Gera Painel Visual de Recortes em Zoom 800% (Entrada Pixelada 1× vs SVG Reconstruído 800% vs Referência Analítica 800%)
    if (zoomCropVisualTiles.length > 0) {
      await fs.mkdir('/opt/cursor/artifacts', { recursive: true });
      const tileSize = 220;
      const pad = 16;
      const cols = 3;
      const rows = zoomCropVisualTiles.length;
      const panelW = pad + cols * (tileSize + pad);
      const panelH = pad + rows * (tileSize + pad);

      const composites: sharp.OverlayOptions[] = [];
      for (let r = 0; r < rows; r++) {
        const y = pad + r * (tileSize + pad);
        const item = zoomCropVisualTiles[r];
        composites.push(
          { input: item.rasterNearestPng, left: pad, top: y },
          { input: item.vec800Png, left: pad + (tileSize + pad), top: y },
          { input: item.gt800Png, left: pad + 2 * (tileSize + pad), top: y }
        );
      }

      const artifactPath = '/opt/cursor/artifacts/painel-contornos-zoom-800x.png';
      await sharp({
        create: {
          width: panelW,
          height: panelH,
          channels: 4,
          background: { r: 15, g: 23, b: 42, alpha: 1 },
        },
      })
        .composite(composites)
        .png()
        .toFile(artifactPath);

      console.log(`\nPainel de estabilidade vetorial em Zoom 800% salvo em: ${artifactPath}`);
    }

    console.log(
      '\n=== TODOS OS 19 TESTES DE CONTORNOS, MULTI-ZOOM (25%..800%) E 4 RENDERIZADORES APROVADOS ==='
    );
  } finally {
    await browser.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('FALHA NOS TESTES DE CONTORNOS / ZOOM:', err);
  process.exit(1);
});
