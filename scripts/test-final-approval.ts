import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { runVectorizationOnRgba, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 12,
  detailPrecision: 88,
  curveSmoothness: 42,
  pathSimplification: 8,
  noiseRemoval: 0,
  contourSensitivity: 76,
  optimizeSvg: true,
  reconstructGradients: true,
  enhanceTypography: false,
  subpixelUpscale: false,
};

type Status = 'APROVADO' | 'APROVADO COM LIMITAÇÕES' | 'REPROVADO';

async function raster(svg: string, w: number, h: number, format: 'png' | 'jpeg' = 'png'): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const encoded = format === 'jpeg' ? await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 70 }).toBuffer() : png;
  const { data, info } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: format === 'jpeg' ? 'jpeg' : 'png' };
}

function darkAt(svg: string, width: number, x: number, y: number): boolean {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  const sx = Math.min(rendered.width - 1, Math.max(0, Math.round(x)));
  const sy = Math.min(rendered.height - 1, Math.max(0, Math.round(y)));
  const i = (sy * rendered.width + sx) * 4;
  const a = rendered.pixels[i + 3] || 1;
  return (rendered.pixels[i] * 255) / a < 80;
}

async function main() {
  const cases: Array<{
    name: string;
    w: number;
    h: number;
    format?: 'png' | 'jpeg';
    minSsim: number;
    minIou: number;
    limitation?: string;
    expectGradient?: boolean;
    svg: string;
  }> = [
    { name: 'logo sólido', w: 140, h: 100, minSsim: 98, minIou: 96, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#fff"/><rect x="24" y="22" width="92" height="56" rx="8" fill="#111827"/></svg>` },
    { name: 'logo com degradê', w: 140, h: 80, minSsim: 97, minIou: 96, expectGradient: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="80"><rect width="140" height="80" fill="#fff"/><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#e2e8f0"/></linearGradient></defs><rect x="16" y="18" width="108" height="44" fill="url(#s)"/></svg>` },
    { name: 'letra com serifa', w: 120, h: 90, minSsim: 98, minIou: 96, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#fff"/><path d="M52 16 h10 v40 h-10 z M40 56 h34 v6 h-34 z" fill="#111"/></svg>` },
    { name: 'letra sem serifa', w: 80, h: 100, minSsim: 98, minIou: 96, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="#fff"/><rect x="34" y="12" width="12" height="76" fill="#111"/></svg>` },
    { name: 'tipografia fina', w: 120, h: 40, minSsim: 96, minIou: 60, limitation: 'Faixa de 2 px: um pixel de borda derruba o IoU; o Hausdorff fica em 1 px.', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#fff"/><rect x="8" y="18" width="100" height="2" fill="#111"/></svg>` },
    { name: 'símbolo', w: 120, h: 100, minSsim: 96, minIou: 92, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#fff7ed"/><circle cx="60" cy="50" r="28" fill="none" stroke="#9a3412" stroke-width="4"/><circle cx="60" cy="50" r="8" fill="#9a3412"/></svg>` },
    { name: 'ícone', w: 80, h: 80, minSsim: 97, minIou: 94, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#fff"/><circle cx="40" cy="40" r="22" fill="#2563eb"/><rect x="34" y="28" width="12" height="24" fill="#fff"/></svg>` },
    { name: 'ilustração', w: 140, h: 100, minSsim: 97, minIou: 96, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#ecfeff"/><circle cx="48" cy="50" r="26" fill="#0284c7"/><rect x="70" y="30" width="46" height="40" fill="#f59e0b"/></svg>` },
    { name: 'forma geométrica', w: 120, h: 80, minSsim: 98, minIou: 97, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><rect x="30" y="20" width="60" height="40" fill="#111"/></svg>` },
    { name: 'preto sólido', w: 100, h: 70, minSsim: 98, minIou: 97, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><rect width="100" height="70" fill="#fff"/><rect x="18" y="14" width="64" height="42" fill="#000"/></svg>` },
    { name: 'dourado', w: 140, h: 100, minSsim: 93, minIou: 94, expectGradient: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#f8fafc"/><defs><radialGradient id="g" cx="36%" cy="32%" r="70%"><stop offset="0%" stop-color="#fff4c4"/><stop offset="50%" stop-color="#d4a017"/><stop offset="100%" stop-color="#5c3b09"/></radialGradient></defs><ellipse cx="70" cy="50" rx="40" ry="28" fill="url(#g)"/></svg>` },
    { name: 'prateado', w: 140, h: 70, minSsim: 94, minIou: 94, expectGradient: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="70"><rect width="140" height="70" fill="#fff"/><defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#374151"/><stop offset="48%" stop-color="#f8fafc"/><stop offset="100%" stop-color="#6b7280"/></linearGradient></defs><rect x="18" y="16" width="104" height="38" fill="url(#p)"/></svg>` },
    { name: 'reflexo', w: 140, h: 100, minSsim: 93, minIou: 94, expectGradient: true, limitation: 'O brilho entra no gradiente da elipse, não como um caminho separado.', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#f8fafc"/><defs><radialGradient id="g" cx="36%" cy="32%" r="70%"><stop offset="0%" stop-color="#fff4c4"/><stop offset="50%" stop-color="#d4a017"/><stop offset="100%" stop-color="#5c3b09"/></radialGradient></defs><ellipse cx="70" cy="50" rx="40" ry="28" fill="url(#g)"/></svg>` },
    { name: 'transparência', w: 100, h: 70, minSsim: 90, minIou: 90, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><rect x="18" y="14" width="64" height="42" fill="#2563eb"/></svg>` },
    { name: 'JPEG', w: 120, h: 80, format: 'jpeg', minSsim: 94, minIou: 92, limitation: 'A entrada já perdeu detalhe na compressão.', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><circle cx="46" cy="40" r="18" fill="#111"/><rect x="70" y="24" width="28" height="32" fill="#2563eb"/></svg>` },
    { name: 'antialiasing', w: 120, h: 80, minSsim: 97, minIou: 95, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><polygon points="16,64 60,16 104,64" fill="#111"/></svg>` },
    { name: 'fotografia', w: 100, h: 80, minSsim: 96, minIou: 94, limitation: 'A cena é composta de formas lisas, não de uma fotografia de sensor.', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#64748b"/><circle cx="40" cy="36" r="16" fill="#fda4af"/><rect x="58" y="28" width="28" height="34" fill="#1e293b"/></svg>` },
    { name: 'muitos detalhes', w: 140, h: 100, minSsim: 96, minIou: 94, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#fff"/><circle cx="36" cy="40" r="16" fill="#ef4444"/><circle cx="70" cy="40" r="16" fill="#2563eb"/><circle cx="104" cy="40" r="16" fill="#16a34a"/><rect x="28" y="66" width="84" height="14" fill="#111"/></svg>` },
    { name: 'forma pequena', w: 80, h: 60, minSsim: 97, minIou: 90, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#fff"/><rect x="36" y="26" width="6" height="6" fill="#111"/></svg>` },
  ];

  const lines = ['# Aprovação da vetorização', ''];
  let failed = 0;
  for (const item of cases) {
    const started = performance.now();
    let status: Status = 'REPROVADO';
    let detail = '';
    try {
      const image = await raster(item.svg, item.w, item.h, item.format);
      const result = await runVectorizationOnRgba(image, params);
      const ms = Math.round(performance.now() - started);
      const q = result.qualityReport;
      const ssim = q?.ssimPct ?? 0;
      const delta = q?.meanDeltaE2000 ?? q?.meanDeltaELab ?? 99;
      const iou = q?.iouPct ?? 0;
      const contour = q?.contourFidelityPct ?? 0;
      const haus = q?.hausdorffDistancePx ?? 0;
      const paths = result.validation.pathCount;
      const rasterFree = !result.validation.hasEmbeddedRaster && !/<image\b|feImage|data:image/i.test(result.svg);
      const editable = rasterFree && /<path\b|<rect\b/.test(result.svg) && /<g\b/.test(result.svg);
      const gradientOk = !item.expectGradient || /<(linear|radial)Gradient\b/.test(result.svg);
      const metricOk = ssim >= item.minSsim && iou >= item.minIou && delta <= 6 && editable && gradientOk;
      status = !metricOk ? 'REPROVADO' : item.limitation ? 'APROVADO COM LIMITAÇÕES' : 'APROVADO';
      detail = `SSIM ${ssim} ΔE₀₀ ${delta} IoU ${iou} contorno ${contour} Hausdorff ${haus} caminhos ${paths} ${ms} ms ${result.engineUsed}${item.limitation ? ` — ${item.limitation}` : ''}`;
      if (!rasterFree) detail += ' — raster embutido';
    } catch (error) {
      status = 'REPROVADO';
      detail = error instanceof Error ? error.message : String(error);
    }
    if (status === 'REPROVADO') failed++;
    lines.push(`- ${status} — ${item.name}: ${detail}`);
  }

  const letter = await raster(cases[2].svg, 120, 90);
  const letterSvg = (await runVectorizationOnRgba(letter, params)).svg;
  const stem = darkAt(letterSvg, 120 * 16, 57 * 16, 30 * 16);
  const foot = darkAt(letterSvg, 120 * 16, 70 * 16, 59 * 16);
  const gap = darkAt(letterSvg, 120 * 16, 46 * 16, 30 * 16);
  const zoomOk = stem && foot && !gap;
  lines.push(`- ${zoomOk ? 'APROVADO' : 'REPROVADO'} — zoom 1600% da letra: haste ${stem}, pé ${foot}, concavidade vazia ${!gap}`);
  if (!zoomOk) failed++;

  const mono = await runVectorizationOnRgba(
    await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#fff"/><rect x="16" y="14" width="48" height="32" fill="#000"/></svg>`, 80, 60),
    { ...params, engine: 'potrace', colorCount: 2 }
  );
  const potraceOk = mono.engineUsed === 'potrace_bezier' && !mono.validation.hasEmbeddedRaster;
  lines.push(`- ${potraceOk ? 'APROVADO' : 'REPROVADO'} — Potrace monocromático: ${mono.engineUsed}, ${mono.validation.pathCount} caminhos`);
  if (!potraceOk) failed++;

  lines.push('');
  lines.push(failed === 0 ? 'Nenhuma categoria desta suíte foi reprovada.' : `${failed} categoria(s) reprovada(s).`);
  lines.push('Estas cenas são sintéticas e de tamanho controlado. Não cobrem uma fotografia real nem um JPEG grande.');
  const report = lines.join('\n');
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/aprovacao-etapa07.md', report);
  console.log(report);
  assert.equal(failed, 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
