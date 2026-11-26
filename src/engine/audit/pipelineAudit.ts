/**
 * Instrumentação somente de leitura. Não altera limiares, fusões nem a escolha do candidato.
 * Uma sessão por vetorização, no fio único do motor.
 */

export interface SegmentationStageCount {
  stage: string;
  regions: number;
  foregroundPixels: number;
  small12: number;
  small36: number;
}

export interface CandidateAuditRow {
  candidateId: string;
  engineKind: string;
  pathCount: number;
  objectCount: number;
  gradientCount: number;
  ssimPct: number;
  deltaE2000: number;
  chamferPx: number;
  iouPct: number;
  contourFidelityPct: number;
  gradientContinuityPct: number;
  selected: boolean;
  rejected?: boolean;
  reason?: string;
}

export interface PipelineAuditReport {
  resolutions: {
    original: string;
    working: string;
    wasDownscaled: boolean;
    strongEdgesBefore: number;
    strongEdgesAfter: number;
    thinRunsBefore: number;
    thinRunsAfter: number;
  };
  segmentation: SegmentationStageCount[];
  mergedRegions: number;
  protectedRegions: number;
  toneSplitPairs: number;
  disconnectedRegions: number;
  smallRegionsFinal: number;
  highContrastSmallBeforeConsolidation: number;
  highContrastSmallAfterConsolidation: number;
  topology: {
    regionsWithPath: number;
    sharedBoundaries: number;
    holes: number;
    evenOddRegions: number;
    openFilledPaths: number;
    junctionVertices: number;
    tuckEnabled: boolean;
  };
  curves: {
    bezierFits: number;
    bezierMaxDeviationPx: number;
    bezierForcedOverTolerance: number;
    schneiderFits: number;
    schneiderMaxDeviationPx: number;
    schneiderForcedOverTolerance: number;
  };
  fills: {
    solid: number;
    linear: number;
    radial: number;
    compound: number;
    wideSpanKeptSolid: number;
  };
  coverage: {
    regionsChecked: number;
    strokesRejected: number;
    fillsRebuilt: number;
    worstRecall: number;
    missingComponents: number;
  };
  candidates: CandidateAuditRow[];
  selection: {
    reason: string;
    needsReview: boolean;
  };
}

interface AuditSession {
  report: PipelineAuditReport;
}

let session: AuditSession | null = null;

export function isAuditActive(): boolean {
  return session !== null;
}

export function beginPipelineAudit(): void {
  session = {
    report: {
      resolutions: {
        original: '',
        working: '',
        wasDownscaled: false,
        strongEdgesBefore: 0,
        strongEdgesAfter: 0,
        thinRunsBefore: 0,
        thinRunsAfter: 0,
      },
      segmentation: [],
      mergedRegions: 0,
      protectedRegions: 0,
      toneSplitPairs: 0,
      disconnectedRegions: 0,
      smallRegionsFinal: 0,
      highContrastSmallBeforeConsolidation: 0,
      highContrastSmallAfterConsolidation: 0,
      topology: {
        regionsWithPath: 0,
        sharedBoundaries: 0,
        holes: 0,
        evenOddRegions: 0,
        openFilledPaths: 0,
        junctionVertices: 0,
        tuckEnabled: false,
      },
      curves: {
        bezierFits: 0,
        bezierMaxDeviationPx: 0,
        bezierForcedOverTolerance: 0,
        schneiderFits: 0,
        schneiderMaxDeviationPx: 0,
        schneiderForcedOverTolerance: 0,
      },
      fills: {
        solid: 0,
        linear: 0,
        radial: 0,
        compound: 0,
        wideSpanKeptSolid: 0,
      },
      coverage: {
        regionsChecked: 0,
        strokesRejected: 0,
        fillsRebuilt: 0,
        worstRecall: 1,
        missingComponents: 0,
      },
      candidates: [],
      selection: {
        reason: '',
        needsReview: false,
      },
    },
  };
}

export function finishPipelineAudit(): PipelineAuditReport | undefined {
  const report = session?.report;
  session = null;
  return report;
}

export function noteResolution(input: {
  originalWidth: number;
  originalHeight: number;
  workingWidth: number;
  workingHeight: number;
  wasDownscaled: boolean;
  strongEdgesBefore?: number;
  strongEdgesAfter?: number;
  thinRunsBefore?: number;
  thinRunsAfter?: number;
}): void {
  if (!session) return;
  const slot = session.report.resolutions;
  slot.original = `${input.originalWidth}×${input.originalHeight}`;
  slot.working = `${input.workingWidth}×${input.workingHeight}`;
  slot.wasDownscaled = input.wasDownscaled;
  if (input.strongEdgesBefore !== undefined) slot.strongEdgesBefore = input.strongEdgesBefore;
  if (input.strongEdgesAfter !== undefined) slot.strongEdgesAfter = input.strongEdgesAfter;
  if (input.thinRunsBefore !== undefined) slot.thinRunsBefore = input.thinRunsBefore;
  if (input.thinRunsAfter !== undefined) slot.thinRunsAfter = input.thinRunsAfter;
}

export function noteSegmentationStage(stage: string, labelMap: Int32Array): void {
  if (!session) return;
  const counts = new Map<number, number>();
  let foreground = 0;
  for (let i = 0; i < labelMap.length; i++) {
    const id = labelMap[i];
    if (id <= 0) continue;
    foreground++;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let small12 = 0;
  let small36 = 0;
  for (const area of counts.values()) {
    if (area <= 12) small12++;
    if (area <= 36) small36++;
  }
  session.report.segmentation.push({
    stage,
    regions: counts.size,
    foregroundPixels: foreground,
    small12,
    small36,
  });
}

export function noteMergedRegion(): void {
  if (!session) return;
  session.report.mergedRegions++;
}

export function noteProtectedRegions(count: number): void {
  if (!session) return;
  session.report.protectedRegions = count;
}

export function noteHighContrastSmall(before: boolean, count: number): void {
  if (!session) return;
  if (before) session.report.highContrastSmallBeforeConsolidation = count;
  else session.report.highContrastSmallAfterConsolidation = count;
}

export function noteFinalSegmentation(
  labelMap: Int32Array,
  width: number,
  height: number,
  L: Float32Array,
  a: Float32Array,
  b: Float32Array
): void {
  if (!session) return;
  const counts = new Map<number, number>();
  for (let i = 0; i < labelMap.length; i++) {
    const id = labelMap[i];
    if (id > 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let small = 0;
  for (const area of counts.values()) if (area <= 36) small++;
  session.report.smallRegionsFinal = small;

  const pairs = new Set<string>();
  const total = width * height;
  for (let px = 0; px < total; px += 2) {
    const id = labelMap[px];
    if (id <= 0) continue;
    const x = px % width;
    const right = x + 1 < width ? labelMap[px + 1] : 0;
    const down = px + width < total ? labelMap[px + width] : 0;
    considerTonePair(pairs, id, right, px, px + 1, L, a, b);
    considerTonePair(pairs, id, down, px, px + width, L, a, b);
  }
  session.report.toneSplitPairs = pairs.size;
  session.report.disconnectedRegions = countDisconnected(labelMap, width, height);
}

export function noteTopology(input: PipelineAuditReport['topology']): void {
  if (!session) return;
  const current = session.report.topology.regionsWithPath;
  if (current > 0 && input.regionsWithPath <= current) return;
  session.report.topology = input;
}

export function noteBezierDeviation(deviationPx: number, forced: boolean): void {
  if (!session) return;
  const slot = session.report.curves;
  slot.bezierFits++;
  if (deviationPx > slot.bezierMaxDeviationPx) slot.bezierMaxDeviationPx = round2(deviationPx);
  if (forced && deviationPx > 1) slot.bezierForcedOverTolerance++;
}

export function noteSchneiderDeviation(deviationPx: number, forced: boolean): void {
  if (!session) return;
  const slot = session.report.curves;
  slot.schneiderFits++;
  if (deviationPx > slot.schneiderMaxDeviationPx) slot.schneiderMaxDeviationPx = round2(deviationPx);
  if (forced && deviationPx > 1) slot.schneiderForcedOverTolerance++;
}

export function noteFill(kind: string, colorSpan: number, meanDeltaE: number): void {
  if (!session) return;
  const slot = session.report.fills;
  if (kind === 'linear') slot.linear++;
  else if (kind === 'radial') slot.radial++;
  else if (kind === 'compound') slot.compound++;
  else {
    slot.solid++;
    if (colorSpan > 12 && meanDeltaE > 2.2) slot.wideSpanKeptSolid++;
  }
}

export function noteRegionCoverage(input: {
  recall: number;
  missingComponents?: number;
  strokeRejected?: boolean;
  fillRebuilt?: boolean;
}): void {
  if (!session) return;
  const slot = session.report.coverage;
  slot.regionsChecked++;
  if (input.strokeRejected) slot.strokesRejected++;
  if (input.fillRebuilt) slot.fillsRebuilt++;
  if (input.recall < slot.worstRecall) slot.worstRecall = round2(input.recall);
  slot.missingComponents += input.missingComponents ?? 0;
}

export function noteSelection(reason: string, needsReview: boolean): void {
  if (!session) return;
  session.report.selection = { reason, needsReview };
}

export function noteCandidate(row: CandidateAuditRow): void {
  if (!session) return;
  session.report.candidates.push(row);
}

function considerTonePair(
  pairs: Set<string>,
  left: number,
  right: number,
  pxA: number,
  pxB: number,
  L: Float32Array,
  a: Float32Array,
  b: Float32Array
): void {
  if (right <= 0 || right === left) return;
  const de = Math.hypot(L[pxA] - L[pxB], a[pxA] - a[pxB], b[pxA] - b[pxB]);
  if (de > 5.5) return;
  const lo = Math.min(left, right);
  const hi = Math.max(left, right);
  pairs.add(`${lo}:${hi}`);
}

function countDisconnected(labelMap: Int32Array, width: number, height: number): number {
  const seen = new Uint8Array(labelMap.length);
  let extra = 0;
  const sizes = new Map<number, number>();
  for (let start = 0; start < labelMap.length; start++) {
    const id = labelMap[start];
    if (id <= 0 || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    while (stack.length > 0) {
      const px = stack.pop() as number;
      count++;
      const x = px % width;
      const y = (px - x) / width;
      const nbs = [
        x > 0 ? px - 1 : -1,
        x + 1 < width ? px + 1 : -1,
        y > 0 ? px - width : -1,
        y + 1 < height ? px + width : -1,
      ];
      for (const n of nbs) {
        if (n < 0 || seen[n] || labelMap[n] !== id) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    const prev = sizes.get(id) ?? 0;
    if (prev > 0 && count >= 4) extra++;
    sizes.set(id, prev + 1);
  }
  return extra;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function countStrongEdges(data: Uint8Array, width: number, height: number): number {
  let edges = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = (y * width + x) * 4;
      const l = data[i] + data[i + 1] + data[i + 2];
      const r = data[i + 4] + data[i + 5] + data[i + 6];
      const d = data[i + width * 4] + data[i + width * 4 + 1] + data[i + width * 4 + 2];
      if (Math.abs(l - r) + Math.abs(l - d) > 80) edges++;
    }
  }
  return edges;
}

export function countThinRuns(data: Uint8Array, width: number, height: number): number {
  let runs = 0;
  const dark = (px: number) => {
    const i = px * 4;
    return data[i] + data[i + 1] + data[i + 2] < 180;
  };
  for (let y = 1; y < height - 1; y += 2) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      const px = y * width + x;
      const on = dark(px) && !dark(px - width) && !dark(px + width);
      if (on) run++;
      else {
        if (run >= 8) runs++;
        run = 0;
      }
    }
  }
  return runs;
}
