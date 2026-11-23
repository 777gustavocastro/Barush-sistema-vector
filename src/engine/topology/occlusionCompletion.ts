import type { EditableObjectSlot, EditableRegionSlot } from '../stage2/stage2RefinementEngine';

/**
 * Quando um símbolo cobre parte de outro, a forma de trás volta a ser o retângulo
 * completo e o símbolo da frente permanece depois na ordem de pintura.
 * Objetos da mesma família não são fundidos. Um entalhe que não é outro objeto fica como está.
 */
export function restoreOccludedRectangles(
  labelMap: Int32Array,
  width: number,
  slots: Map<number, EditableRegionSlot>,
  objectSlots: EditableObjectSlot[]
): number {
  let restored = 0;
  const paintFrontAfter = new Map<number, number>();

  for (const slot of slots.values()) {
    if (slot.contourStroke || slot.usesEvenOdd || slot.fillKind !== 'solid') continue;
    const sub = slot.sub;
    const { minX, minY, maxX, maxY } = sub;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bw < 10 || bh < 10) continue;
    const bboxArea = bw * bh;
    const coverage = sub.pixelCount / bboxArea;
    if (coverage < 0.58 || coverage > 0.93) continue;

    const idAt = (x: number, y: number) => labelMap[y * width + x];
    if (
      idAt(minX, minY) !== sub.id ||
      idAt(maxX, minY) !== sub.id ||
      idAt(minX, maxY) !== sub.id ||
      idAt(maxX, maxY) !== sub.id
    ) {
      continue;
    }

    const intruder = new Map<number, number>();
    let foreign = 0;
    for (let y = minY; y <= maxY; y++) {
      const row = y * width;
      for (let x = minX; x <= maxX; x++) {
        const id = labelMap[row + x];
        if (id === sub.id || id <= 0) continue;
        foreign++;
        intruder.set(id, (intruder.get(id) ?? 0) + 1);
      }
    }
    const deficit = bboxArea - sub.pixelCount;
    if (foreign < deficit * 0.72 || intruder.size !== 1) continue;
    const frontId = intruder.keys().next().value as number;
    const front = slots.get(frontId);
    if (!front || front.parentObjectId === slot.parentObjectId) continue;

    slot.pathD = `M ${minX} ${minY} L ${maxX + 1} ${minY} L ${maxX + 1} ${maxY + 1} L ${minX} ${maxY + 1} Z`;
    paintFrontAfter.set(front.parentObjectId, slot.parentObjectId);
    restored++;
  }

  for (const [frontObjectId, backObjectId] of paintFrontAfter) {
    const frontIndex = objectSlots.findIndex((obj) => obj.objectId === frontObjectId);
    const backIndex = objectSlots.findIndex((obj) => obj.objectId === backObjectId);
    if (frontIndex < 0 || backIndex < 0 || frontIndex > backIndex) continue;
    const [front] = objectSlots.splice(frontIndex, 1);
    const backNow = objectSlots.findIndex((obj) => obj.objectId === backObjectId);
    objectSlots.splice(backNow + 1, 0, front);
  }

  return restored;
}
