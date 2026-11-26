export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export interface PricedLine {
  quantity: number;
  unitPrice: number;
  discount: number;
}

export function lineGross(line: PricedLine): number {
  return money(Math.max(0, line.quantity) * Math.max(0, line.unitPrice));
}

export function lineNet(line: PricedLine): number {
  return money(Math.max(0, lineGross(line) - Math.max(0, line.discount)));
}

export function quoteSale(lines: PricedLine[], discount: number, addition: number) {
  const subtotal = money(lines.reduce((sum, line) => sum + lineNet(line), 0));
  const safeDiscount = money(Math.min(subtotal, Math.max(0, discount)));
  const safeAddition = money(Math.max(0, addition));
  return {
    subtotal,
    discount: safeDiscount,
    addition: safeAddition,
    total: money(Math.max(0, subtotal - safeDiscount + safeAddition)),
  };
}
