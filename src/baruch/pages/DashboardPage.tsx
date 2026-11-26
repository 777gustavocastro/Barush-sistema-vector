import {
  Banknote,
  CircleDollarSign,
  Clock3,
  Package,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import {
  buildDashboardView,
  type ChartGrain,
  type DashboardPeriod,
  type DashboardPoint,
} from '../data/dashboardData';
import { formatBRL } from '../data/mockData';
import type { ProductionFocus } from '../types';

interface DashboardPageProps {
  onOpenProduction: (focus: ProductionFocus) => void;
}

const PERIODS: Array<{ id: DashboardPeriod; label: string }> = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'month', label: 'Este mês' },
  { id: 'year', label: 'Este ano' },
  { id: 'custom', label: 'Personalizado' },
];

const GRAINS: Array<{ id: ChartGrain; label: string }> = [
  { id: 'day', label: 'Dia' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' },
];

type DashboardPageTone = 'neutral' | 'gold' | 'positive' | 'alert';

const PRODUCTION_TONE: Record<DashboardPageTone, string> = {
  neutral: 'text-[#071A34]',
  gold: 'text-[#9A7220]',
  positive: 'text-emerald-700',
  alert: 'text-rose-700',
};

export function DashboardPage({ onOpenProduction }: DashboardPageProps) {
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [customStart, setCustomStart] = useState('2026-11-01');
  const [customEnd, setCustomEnd] = useState('2026-11-25');
  const [grain, setGrain] = useState<ChartGrain>('day');

  const view = useMemo(
    () => buildDashboardView(period, customStart, customEnd, grain),
    [period, customStart, customEnd, grain],
  );

  const handlePeriod = (next: DashboardPeriod) => {
    setPeriod(next);
    if (next === 'today') setGrain('day');
    if (next === 'year' && grain === 'day') setGrain('month');
    if (next === 'month' || next === '30d') setGrain('day');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Dashboard
          </h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">Visão geral da gráfica.</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1" role="group" aria-label="Período">
            {PERIODS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handlePeriod(item.id)}
                aria-pressed={period === item.id}
                className={`h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${
                  period === item.id
                    ? 'bg-[#071A34] text-white'
                    : 'bg-white border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                aria-label="Data inicial"
                className="h-8 px-2 rounded-md bg-white border border-[#E4EAF1] text-[12px] text-[#0F1E36]"
              />
              <span className="text-[12px] text-[#5A6B82]">até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                aria-label="Data final"
                className="h-8 px-2 rounded-md bg-white border border-[#E4EAF1] text-[12px] text-[#0F1E36]"
              />
            </div>
          )}
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Indicator
          label="Faturamento"
          value={formatBRL(view.revenue)}
          hint={`+${view.revenueDelta.toLocaleString('pt-BR')}% vs. período anterior`}
          hintClass="text-emerald-700"
          icon={CircleDollarSign}
        />
        <Indicator
          label="Valor recebido"
          value={formatBRL(view.received)}
          hint="Total efetivamente recebido"
          icon={Wallet}
        />
        <Indicator
          label="A receber"
          value={formatBRL(view.pending)}
          hint="Pendente de pagamento"
          icon={Clock3}
        />
        <Indicator
          label="Lucro estimado"
          value={formatBRL(view.profit)}
          hint="Resultado após custos"
          icon={Banknote}
        />
        <Indicator
          label="Vendas"
          value={String(view.salesCount)}
          hint="Vendas realizadas no período"
          icon={ShoppingBag}
        />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[13.5px] font-semibold text-[#071A34]">Desempenho de vendas</h3>
              <p className="text-[12px] text-[#5A6B82]">{view.rangeLabel}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-3 text-[11.5px] text-[#5A6B82]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-3 rounded-full bg-[#071A34]" />
                  Faturamento
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-3 rounded-full bg-[#C89B3C]" />
                  Recebido
                </span>
              </div>
              <div className="flex rounded-md bg-white border border-[#E4EAF1] p-0.5">
                {GRAINS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setGrain(item.id)}
                    className={`h-6 px-2 rounded text-[11.5px] font-medium ${
                      grain === item.id ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="bg-white border border-[#E4EAF1] rounded-lg px-3 pt-3 pb-2">
            <SalesLineChart points={view.series} />
          </div>
        </section>

        <section className="xl:col-span-4">
          <h3 className="text-[13.5px] font-semibold text-[#071A34] mb-2">Vendas por categoria</h3>
          <div className="bg-white border border-[#E4EAF1] rounded-lg p-4 h-[calc(100%-1.75rem)]">
            <CategoryDonut
              slices={view.categories}
              total={view.revenue}
            />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section>
          <h3 className="text-[13.5px] font-semibold text-[#071A34] mb-2">Produtos mais vendidos</h3>
          <div className="bg-white border border-[#E4EAF1] rounded-lg divide-y divide-[#F1F5F9]">
            {view.products.map((product) => (
              <div key={product.name} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#0F1E36] truncate">{product.name}</div>
                  <div className="text-[11.5px] text-[#5A6B82]">{product.quantity} unidades</div>
                </div>
                <div className="text-[13px] font-semibold text-[#071A34] tabular-nums shrink-0">
                  {formatBRL(product.revenue)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[13.5px] font-semibold text-[#071A34] mb-2">Produção em andamento</h3>
          <div className="bg-white border border-[#E4EAF1] rounded-lg grid grid-cols-2">
            {view.production.map((item) => (
              <button
                key={item.focus}
                type="button"
                onClick={() => onOpenProduction(item.focus)}
                className="px-3.5 py-3 text-left hover:bg-[#F8FAFC] transition-colors border-[#F1F5F9] [&:nth-child(odd)]:border-r [&:nth-child(-n+2)]:border-b"
              >
                <div className={`text-[20px] font-semibold tabular-nums leading-none ${PRODUCTION_TONE[item.tone]}`}>
                  {item.count}
                </div>
                <div className="text-[12px] text-[#5A6B82] mt-1.5 leading-snug">{item.label}</div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[13.5px] font-semibold text-[#071A34] mb-2">Próximas entregas</h3>
          <div className="bg-white border border-[#E4EAF1] rounded-lg divide-y divide-[#F1F5F9]">
            {view.deliveries.map((delivery) => (
              <div key={delivery.client} className="px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-[#0F1E36] truncate">{delivery.client}</span>
                  <span className={`text-[11.5px] font-medium shrink-0 ${delivery.urgent ? 'text-[#9A7220]' : 'text-[#5A6B82]'}`}>
                    {delivery.when}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[11.5px] text-[#5A6B82]">
                  <span className="truncate">{delivery.order}</span>
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <span className={`h-1.5 w-1.5 rounded-full ${delivery.urgent ? 'bg-[#C89B3C]' : 'bg-slate-300'}`} />
                    {delivery.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-8">
          <h3 className="text-[13.5px] font-semibold text-[#071A34] mb-2">Vendas recentes</h3>
          <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
            {view.sales.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-[#5A6B82]">
                Nenhuma venda neste período.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[11.5px] font-medium text-[#5A6B82]">
                      <th className="py-2.5 px-3.5 font-medium">Nº</th>
                      <th className="py-2.5 px-3.5 font-medium">Cliente</th>
                      <th className="py-2.5 px-3.5 font-medium">Data</th>
                      <th className="py-2.5 px-3.5 font-medium">Produtos</th>
                      <th className="py-2.5 px-3.5 font-medium">Pagamento</th>
                      <th className="py-2.5 px-3.5 font-medium">Status</th>
                      <th className="py-2.5 px-3.5 font-medium text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="text-[13px]">
                    {view.sales.map((sale) => (
                      <tr key={sale.code} className="border-t border-[#F4F7FB]">
                        <td className="py-2.5 px-3.5 font-mono text-[12px] text-[#071A34]">{sale.code}</td>
                        <td className="py-2.5 px-3.5 font-medium text-[#0F1E36]">{sale.client}</td>
                        <td className="py-2.5 px-3.5 text-[#5A6B82] whitespace-nowrap">
                          {sale.date.slice(8, 10)}/{sale.date.slice(5, 7)}
                        </td>
                        <td className="py-2.5 px-3.5 text-[#5A6B82]">{sale.products}</td>
                        <td className="py-2.5 px-3.5 text-[#334155]">{sale.payment}</td>
                        <td className="py-2.5 px-3.5">
                          <span
                            className={`text-[11.5px] font-medium ${
                              sale.status === 'Pago' ? 'text-emerald-700' : 'text-[#9A7220]'
                            }`}
                          >
                            {sale.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-semibold text-[#071A34] tabular-nums whitespace-nowrap">
                          {formatBRL(sale.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="xl:col-span-4">
          <h3 className="text-[13.5px] font-semibold text-[#071A34] mb-2">Despesas recentes</h3>
          <div className="bg-white border border-[#E4EAF1] rounded-lg">
            {view.expenses.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-[#5A6B82]">
                Nenhuma despesa neste período.
              </p>
            ) : (
              <div className="divide-y divide-[#F4F7FB]">
                {view.expenses.map((expense) => (
                  <div key={expense.description} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-[#0F1E36] truncate">{expense.description}</div>
                      <div className="text-[11.5px] text-[#5A6B82]">
                        {expense.category} · {expense.date.slice(8, 10)}/{expense.date.slice(5, 7)}
                      </div>
                    </div>
                    <div className="text-[13px] font-semibold text-[#071A34] tabular-nums shrink-0">
                      {formatBRL(expense.value)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Indicator({
  label,
  value,
  hint,
  hintClass = 'text-[#5A6B82]',
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  hintClass?: string;
  icon: typeof Package;
}) {
  return (
    <article className="bg-white border border-[#E4EAF1] rounded-lg px-3.5 py-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-[#5A6B82] truncate">{label}</span>
        <Icon className="w-3.5 h-3.5 text-[#8E9AAB] shrink-0" strokeWidth={1.75} />
      </div>
      <div className="mt-1.5 text-[17px] xl:text-[18px] font-semibold text-[#071A34] tabular-nums tracking-[-0.02em]">
        {value}
      </div>
      <div className={`mt-1 text-[11.5px] leading-snug ${hintClass}`}>{hint}</div>
    </article>
  );
}

function SalesLineChart({ points }: { points: DashboardPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 228;
  const pad = { left: 48, right: 12, top: 14, bottom: 28 };
  const max = Math.max(1, ...points.flatMap((point) => [point.revenue, point.received]));
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const xAt = (index: number) =>
    pad.left + (points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const yAt = (value: number) => pad.top + (1 - value / max) * innerHeight;
  const line = (key: 'revenue' | 'received') =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(1)} ${yAt(point[key]).toFixed(1)}`)
      .join(' ');
  const ticks = [0, 0.5, 1].map((ratio) => Math.round(max * ratio));
  const labelStep = Math.ceil(points.length / 6);

  const move = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    points.forEach((_, index) => {
      const gap = Math.abs(xAt(index) - relative);
      if (gap < distance) {
        distance = gap;
        nearest = index;
      }
    });
    setHover(nearest);
  };

  const active = hover == null ? null : points[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[228px]"
        role="img"
        aria-label="Evolução de faturamento e valores recebidos"
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="#EEF2F6"
              strokeWidth="1"
            />
            <text x={pad.left - 8} y={yAt(tick) + 3} textAnchor="end" className="fill-[#8B9AAD]" fontSize="10">
              {compactAxis(tick, max)}
            </text>
          </g>
        ))}
        <path d={line('revenue')} fill="none" stroke="#071A34" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line('received')} fill="none" stroke="#C89B3C" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => (
          <g key={point.label + index}>
            {(index % labelStep === 0 || index === points.length - 1) && (
              <text x={xAt(index)} y={height - 8} textAnchor="middle" className="fill-[#8B9AAD]" fontSize="10">
                {point.label}
              </text>
            )}
          </g>
        ))}
        {hover != null && active && (
          <g>
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={pad.top}
              y2={height - pad.bottom}
              stroke="#D7DEE7"
              strokeDasharray="3 3"
            />
            <circle cx={xAt(hover)} cy={yAt(active.revenue)} r="3.5" fill="#071A34" />
            <circle cx={xAt(hover)} cy={yAt(active.received)} r="3.5" fill="#C89B3C" />
          </g>
        )}
      </svg>
      {active && hover != null && (
        <div
          className="pointer-events-none absolute top-2 bg-white border border-[#E4EAF1] rounded-lg px-2.5 py-2 shadow-sm text-[11.5px] min-w-[148px]"
          style={{ left: `${Math.min(78, Math.max(8, (xAt(hover) / width) * 100 - 8))}%` }}
        >
          <div className="font-medium text-[#071A34] mb-1">{active.label}</div>
          <div className="flex justify-between gap-3 text-[#334155]">
            <span>Faturamento</span>
            <span className="tabular-nums font-medium">{formatBRL(active.revenue)}</span>
          </div>
          <div className="flex justify-between gap-3 text-[#334155]">
            <span>Recebido</span>
            <span className="tabular-nums font-medium">{formatBRL(active.received)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryDonut({
  slices,
  total,
}: {
  slices: Array<{ name: string; percent: number; value: number; color: string }>;
  total: number;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col sm:flex-row xl:flex-col gap-4 items-center sm:items-start xl:items-stretch h-full">
      <svg viewBox="0 0 120 120" className="w-[132px] h-[132px] shrink-0 mx-auto" role="img" aria-label="Distribuição de vendas por categoria">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#F1F5F9" strokeWidth="14" />
        {slices.map((slice) => {
          const length = (slice.percent / 100) * circumference;
          const dash = `${length} ${circumference - length}`;
          const segment = (
            <circle
              key={slice.name}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth="14"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform="rotate(-90 60 60)"
            />
          );
          offset += length;
          return segment;
        })}
        <text x="60" y="57" textAnchor="middle" className="fill-[#071A34]" fontSize="11" fontWeight="600">
          {compactAxis(total, total)}
        </text>
        <text x="60" y="70" textAnchor="middle" className="fill-[#8B9AAD]" fontSize="8">
          total
        </text>
      </svg>
      <ul className="flex-1 w-full space-y-1.5">
        {slices.map((slice) => (
          <li key={slice.name} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 min-w-0 text-[#334155]">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
              <span className="truncate">{slice.name}</span>
            </span>
            <span className="tabular-nums text-[#071A34] shrink-0">
              {slice.percent}% · {formatBRL(slice.value || Math.round((total * slice.percent) / 100))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function compactAxis(value: number, max: number): string {
  if (value === 0) return '0';
  if (max >= 1000) {
    const compact = Math.round((value / 1000) * 10) / 10;
    const digits = Number.isInteger(compact) ? 0 : 1;
    return `${compact.toLocaleString('pt-BR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })} mil`;
  }
  return Math.round(value).toLocaleString('pt-BR');
}
