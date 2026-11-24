import assert from 'node:assert/strict';
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

async function raster(svg: string, w: number, h: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

async function main() {
  const cases = [
    {
      name: 'degradê',
      w: 140,
      h: 80,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="80"><rect width="140" height="80" fill="#fff"/><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#e2e8f0"/></linearGradient></defs><rect x="16" y="18" width="108" height="44" fill="url(#s)"/></svg>`,
    },
    {
      name: 'logo',
      w: 120,
      h: 60,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="60" height="60" fill="#ef4444"/><rect x="60" width="60" height="60" fill="#2563eb"/></svg>`,
    },
    {
      name: 'letra',
      w: 120,
      h: 90,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#fff"/><path d="M52 16 h10 v40 h-10 z M40 56 h34 v6 h-34 z" fill="#111"/></svg>`,
    },
    {
      name: 'ouro',
      w: 140,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#f8fafc"/><defs><radialGradient id="g" cx="36%" cy="32%" r="70%"><stop offset="0%" stop-color="#fff4c4"/><stop offset="50%" stop-color="#d4a017"/><stop offset="100%" stop-color="#5c3b09"/></radialGradient></defs><ellipse cx="70" cy="50" rx="40" ry="28" fill="url(#g)"/></svg>`,
    },
  ];

  for (const item of cases) {
    const result = await runVectorizationOnRgba(await raster(item.svg, item.w, item.h), params);
    const audit = result.pipelineAudit;
    assert.ok(audit, item.name);
    assert.ok(audit.selection.reason.length > 12, `${item.name} sem motivo`);
    assert.equal(audit.selection.needsReview, false, `${item.name} marcado para revisão`);
    const selected = audit.candidates.find((row) => row.selected);
    assert.ok(selected, item.name);
    assert.equal(selected.rejected, false, `${item.name} vencedor rejeitado`);
    for (const row of audit.candidates) {
      if (row.deltaE2000 > 8 || row.iouPct < 72) {
        assert.equal(row.rejected, true, `${item.name} ${row.candidateId} deveria ser rejeitado`);
        assert.equal(row.selected, false, `${item.name} ${row.candidateId} venceu com defeito`);
      }
    }
    assert.equal(result.validation.hasEmbeddedRaster, false, item.name);
    console.log(item.name, selected.candidateId, selected.deltaE2000, selected.iouPct, audit.selection.reason);
  }
  console.log('seleção: ok', cases.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
