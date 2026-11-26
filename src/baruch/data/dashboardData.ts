import type { ProductionFocus } from '../types';

export type DashboardPeriod = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
export type ChartGrain = 'day' | 'week' | 'month';

export interface DashboardPoint {
  label: string;
  revenue: number;
  received: number;
}

export interface DashboardCategory {
  name: string;
  percent: number;
  value: number;
  color: string;
}

export interface DashboardProduct {
  name: string;
  quantity: number;
  revenue: number;
}

export interface DashboardSale {
  code: string;
  client: string;
  date: string;
  products: string;
  value: number;
  payment: 'Pix' | 'Cartão' | 'Dinheiro';
  status: 'Pago' | 'Parcial';
}

export interface DashboardExpense {
  description: string;
  category: string;
  date: string;
  value: number;
}

export interface DashboardDelivery {
  client: string;
  order: string;
  when: string;
  status: string;
  urgent: boolean;
}

export interface DashboardProductionItem {
  focus: ProductionFocus;
  label: string;
  count: number;
  tone: 'neutral' | 'gold' | 'positive' | 'alert';
}

export interface DashboardView {
  rangeLabel: string;
  revenue: number;
  received: number;
  pending: number;
  profit: number;
  salesCount: number;
  revenueDelta: number;
  series: DashboardPoint[];
  categories: DashboardCategory[];
  products: DashboardProduct[];
  production: DashboardProductionItem[];
  deliveries: DashboardDelivery[];
  sales: DashboardSale[];
  expenses: DashboardExpense[];
}

const MONTH_REVENUE = 18450;
const MONTH_RECEIVED = 15280;
const MONTH_PROFIT = 8420;
const MONTH_SALES = 86;

const CATEGORIES: Array<Omit<DashboardCategory, 'value'>> = [
  { name: 'Comunicação visual', percent: 35, color: '#071A34' },
  { name: 'Personalização', percent: 28, color: '#C89B3C' },
  { name: 'Impressão gráfica', percent: 18, color: '#3D5A80' },
  { name: 'Uniformes', percent: 12, color: '#6B8F71' },
  { name: 'Personalização a laser', percent: 7, color: '#8E9AAB' },
];

const BASE_PRODUCTS: Array<{ name: string; quantity: number; share: number }> = [
  { name: 'Camisetas personalizadas', quantity: 38, share: 0.288 },
  { name: 'Canecas', quantity: 27, share: 0.132 },
  { name: 'Banners', quantity: 19, share: 0.226 },
  { name: 'Cartões de visita', quantity: 16, share: 0.143 },
  { name: 'Adesivos', quantity: 14, share: 0.091 },
];

const SALES: DashboardSale[] = [
  {
    code: '#1086',
    client: 'João Silva',
    date: '2026-11-25',
    products: '20 camisetas',
    value: 450,
    payment: 'Pix',
    status: 'Pago',
  },
  {
    code: '#1085',
    client: 'Empresa Horizonte',
    date: '2026-11-25',
    products: '2 banners',
    value: 890,
    payment: 'Cartão',
    status: 'Pago',
  },
  {
    code: '#1084',
    client: 'Ana Martins',
    date: '2026-11-24',
    products: '15 canecas',
    value: 280,
    payment: 'Dinheiro',
    status: 'Pago',
  },
  {
    code: '#1083',
    client: 'Grupo Alpha',
    date: '2026-11-23',
    products: '10 uniformes',
    value: 1250,
    payment: 'Pix',
    status: 'Parcial',
  },
  {
    code: '#1082',
    client: 'Carlos Souza',
    date: '2026-11-21',
    products: 'Adesivos',
    value: 320,
    payment: 'Cartão',
    status: 'Pago',
  },
];

const EXPENSES: DashboardExpense[] = [
  { description: 'Compra de materiais', category: 'Materiais', date: '2026-11-24', value: 680 },
  { description: 'Tintas e insumos', category: 'Insumos', date: '2026-11-22', value: 420 },
  { description: 'Embalagens', category: 'Embalagens', date: '2026-11-20', value: 160 },
  { description: 'Manutenção', category: 'Manutenção', date: '2026-11-18', value: 350 },
];

const DELIVERIES: DashboardDelivery[] = [
  {
    client: 'João Silva',
    order: '20 camisetas',
    when: 'Amanhã',
    status: 'Em produção',
    urgent: true,
  },
  {
    client: 'Empresa Horizonte',
    order: '2 banners',
    when: '27/11',
    status: 'Pronto para entrega',
    urgent: true,
  },
  {
    client: 'Ana Martins',
    order: '15 canecas',
    when: '28/11',
    status: 'Em produção',
    urgent: false,
  },
  {
    client: 'Grupo Alpha',
    order: '10 uniformes',
    when: '29/11',
    status: 'Aguardando aprovação',
    urgent: false,
  },
];

const PRODUCTION: DashboardProductionItem[] = [
  { focus: 'aprovacao', label: 'Aguardando aprovação', count: 6, tone: 'gold' },
  { focus: 'em_producao', label: 'Em produção', count: 9, tone: 'neutral' },
  { focus: 'pronto', label: 'Pronto para entrega', count: 4, tone: 'positive' },
  { focus: 'atrasados', label: 'Atrasados', count: 2, tone: 'alert' },
];

/** Meses de 2026 até novembro, com novembro fechando no faturamento de referência. */
const YEAR_MONTHS: Array<{ label: string; revenue: number; received: number }> = [
  { label: 'Jan', revenue: 14200, received: 13100 },
  { label: 'Fev', revenue: 12840, received: 11920 },
  { label: 'Mar', revenue: 15110, received: 14040 },
  { label: 'Abr', revenue: 13680, received: 12450 },
  { label: 'Mai', revenue: 14920, received: 13680 },
  { label: 'Jun', revenue: 15760, received: 14210 },
  { label: 'Jul', revenue: 13940, received: 12680 },
  { label: 'Ago', revenue: 16220, received: 14890 },
  { label: 'Set', revenue: 15480, received: 14110 },
  { label: 'Out', revenue: 17150, received: 15320 },
  { label: 'Nov', revenue: MONTH_REVENUE, received: MONTH_RECEIVED },
];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseISO(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toISO(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatShort(date: Date): string {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (let cursor = startOfDay(start); cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

function weightsFor(length: number, seed: number): number[] {
  return Array.from({ length }, (_, index) => {
    const wave = 0.62 + 0.38 * Math.sin(index / 2.35 + seed);
    const weekday = new Date(2026, 10, 1 + index).getDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.42 : 1;
    return Math.max(0.18, wave * weekend);
  });
}

function allocate(weights: number[], total: number): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((acc, value) => acc + value, 0);
  const raw = weights.map((weight) => Math.round((weight / sum) * total));
  const drift = total - raw.reduce((acc, value) => acc + value, 0);
  raw[raw.length - 1] += drift;
  return raw;
}

function daysInRange(period: DashboardPeriod, customStart: string, customEnd: string, today: Date) {
  const end = startOfDay(today);
  if (period === 'today') return [end];
  if (period === '7d') return eachDay(addDays(end, -6), end);
  if (period === '30d') return eachDay(addDays(end, -29), end);
  if (period === 'year') return eachDay(new Date(end.getFullYear(), 0, 1), end);
  if (period === 'custom') {
    const start = parseISO(customStart);
    const finish = parseISO(customEnd);
    const from = start <= finish ? start : finish;
    const to = start <= finish ? finish : start;
    const span = eachDay(from, to);
    return span.length > 0 ? span.slice(0, 120) : [end];
  }
  return eachDay(new Date(end.getFullYear(), end.getMonth(), 1), end);
}

function rangeLabel(period: DashboardPeriod, days: Date[]): string {
  if (period === 'today') {
    return `Hoje, ${days[0].toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}`;
  }
  if (period === 'month') return 'Novembro de 2026';
  if (period === 'year') return 'Ano de 2026';
  if (days.length === 1) return formatShort(days[0]);
  return `${formatShort(days[0])} – ${formatShort(days[days.length - 1])}`;
}

function totalsFor(period: DashboardPeriod, dayCount: number) {
  if (period === 'month') {
    return {
      revenue: MONTH_REVENUE,
      received: MONTH_RECEIVED,
      profit: MONTH_PROFIT,
      salesCount: MONTH_SALES,
      revenueDelta: 12.8,
    };
  }
  if (period === 'today') {
    return { revenue: 980, received: 810, profit: 430, salesCount: 4, revenueDelta: 6.2 };
  }
  if (period === '7d') {
    return { revenue: 4920, received: 4180, profit: 2140, salesCount: 23, revenueDelta: 4.1 };
  }
  if (period === '30d') {
    return { revenue: 19120, received: 15840, profit: 8740, salesCount: 91, revenueDelta: 9.4 };
  }
  if (period === 'year') {
    const revenue = YEAR_MONTHS.reduce((acc, month) => acc + month.revenue, 0);
    const received = YEAR_MONTHS.reduce((acc, month) => acc + month.received, 0);
    return {
      revenue,
      received,
      profit: 72480,
      salesCount: 812,
      revenueDelta: 8.6,
    };
  }
  const factor = dayCount / 25;
  return {
    revenue: Math.round(MONTH_REVENUE * factor),
    received: Math.round(MONTH_RECEIVED * factor),
    profit: Math.round(MONTH_PROFIT * factor),
    salesCount: Math.max(1, Math.round(MONTH_SALES * factor)),
    revenueDelta: Number((4 + (dayCount % 9) * 0.7).toFixed(1)),
  };
}

function seriesFor(
  period: DashboardPeriod,
  days: Date[],
  revenue: number,
  received: number,
  grain: ChartGrain,
): DashboardPoint[] {
  if (period === 'year' && grain === 'month') return YEAR_MONTHS;
  if (period === 'year' && grain === 'week') {
    return groupDays(
      days,
      allocate(weightsFor(days.length, 1.2), revenue),
      allocate(weightsFor(days.length, 2.1), received),
      'week',
    );
  }
  if (period === 'year' && grain === 'day') {
    const revenues = allocate(weightsFor(days.length, 1.2), revenue);
    const receivedValues = allocate(weightsFor(days.length, 2.1), received);
    return days.map((day, index) => ({
      label: formatShort(day),
      revenue: revenues[index],
      received: receivedValues[index],
    }));
  }
  if (period === 'today') {
    const hours = ['08h', '10h', '12h', '14h', '16h', '18h'];
    const revenues = allocate([0.6, 1, 1.3, 0.9, 1.4, 0.7], revenue);
    const receivedValues = allocate([0.4, 1.1, 1.2, 0.8, 1.3, 0.6], received);
    return hours.map((label, index) => ({
      label,
      revenue: revenues[index],
      received: receivedValues[index],
    }));
  }

  const revenues = allocate(weightsFor(days.length, 0.8), revenue);
  const receivedValues = allocate(weightsFor(days.length, 1.7), received);
  if (grain === 'day' || days.length <= 7) {
    return days.map((day, index) => ({
      label: formatShort(day),
      revenue: revenues[index],
      received: receivedValues[index],
    }));
  }
  return groupDays(days, revenues, receivedValues, grain === 'month' ? 'month' : 'week');
}

function groupDays(
  days: Date[],
  revenues: number[],
  receivedValues: number[],
  grain: 'week' | 'month',
): DashboardPoint[] {
  const groups = new Map<string, DashboardPoint>();
  days.forEach((day, index) => {
    const key =
      grain === 'month'
        ? `${day.getFullYear()}-${day.getMonth()}`
        : `${day.getFullYear()}-${Math.floor((day.getDate() - 1) / 7)}-${day.getMonth()}`;
    const label =
      grain === 'month'
        ? day.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
        : formatShort(day);
    const current = groups.get(key) ?? {
      label: grain === 'week' ? `Sem. ${formatShort(day).slice(0, 2)}` : label,
      revenue: 0,
      received: 0,
    };
    current.revenue += revenues[index] ?? 0;
    current.received += receivedValues[index] ?? 0;
    groups.set(key, current);
  });
  return [...groups.values()];
}

function inRange(date: string, days: Date[]): boolean {
  const value = date.slice(0, 10);
  const first = toISO(days[0]);
  const last = toISO(days[days.length - 1]);
  return value >= first && value <= last;
}

export function buildDashboardView(
  period: DashboardPeriod,
  customStart: string,
  customEnd: string,
  grain: ChartGrain,
  today = new Date(2026, 10, 25),
): DashboardView {
  const days = daysInRange(period, customStart, customEnd, today);
  const totals = totalsFor(period, days.length);
  const factor = totals.revenue / MONTH_REVENUE;
  const pending = Math.max(0, totals.revenue - totals.received);

  return {
    rangeLabel: rangeLabel(period, days),
    revenue: totals.revenue,
    received: totals.received,
    pending,
    profit: totals.profit,
    salesCount: totals.salesCount,
    revenueDelta: totals.revenueDelta,
    series: seriesFor(period, days, totals.revenue, totals.received, grain),
    categories: CATEGORIES.map((category) => ({
      ...category,
      value: Math.round((totals.revenue * category.percent) / 100),
    })),
    products: BASE_PRODUCTS.map((product) => ({
      name: product.name,
      quantity: Math.max(1, Math.round(product.quantity * factor)),
      revenue: Math.round(totals.revenue * product.share),
    })),
    production: PRODUCTION,
    deliveries: DELIVERIES,
    sales: SALES.filter((sale) => period === 'year' || period === 'month' || inRange(sale.date, days)),
    expenses: EXPENSES.filter(
      (expense) => period === 'year' || period === 'month' || inRange(expense.date, days),
    ),
  };
}
