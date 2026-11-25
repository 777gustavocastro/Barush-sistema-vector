import { useState } from 'react';
import { CLIENTS, PRODUCTS, formatBRL } from '../data/mockData';

const PERIODS = [
  { id: '30d', label: 'Últimos 30 dias', multiplier: 1 },
  { id: '90d', label: 'Trimestre', multiplier: 2.85 },
  { id: '12m', label: 'Ano atual', multiplier: 10.6 },
] as const;

const MONTHLY_SERIES = [
  { month: 'Jun', revenue: 34200, cost: 18400 },
  { month: 'Jul', revenue: 37800, cost: 19600 },
  { month: 'Ago', revenue: 36100, cost: 18900 },
  { month: 'Set', revenue: 41500, cost: 21100 },
  { month: 'Out', revenue: 43900, cost: 21800 },
  { month: 'Nov', revenue: 46511, cost: 22450 },
];

export function ReportsPage() {
  const [periodId, setPeriodId] = useState<(typeof PERIODS)[number]['id']>('30d');
  const period = PERIODS.find((p) => p.id === periodId) ?? PERIODS[0];

  const revenue = Math.round(46511 * period.multiplier);
  const costs = Math.round(22450 * period.multiplier);
  const profit = revenue - costs;
  const margin = Math.round((profit / revenue) * 100);

  const maxVal = Math.max(...MONTHLY_SERIES.map((d) => d.revenue));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Relatórios e gestão financeira
          </h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Consolidado de vendas, lucro, custos operacionais, produtos e desempenho de clientes.
          </p>
        </div>

        <div className="inline-flex bg-white border border-[#E4EAF1] rounded-md p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriodId(p.id)}
              className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${
                periodId === p.id
                  ? 'bg-[#071A34] text-white'
                  : 'text-[#5A6B82] hover:text-[#071A34]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Resumo financeiro */}
      <div className="bg-white border border-[#E4EAF1] rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#EEF2F7]">
        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Receita bruta</div>
          <div className="text-[20px] font-semibold text-[#071A34] tabular-nums mt-1">
            {formatBRL(revenue)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Custos + despesas</div>
          <div className="text-[20px] font-semibold text-[#071A34] tabular-nums mt-1">
            {formatBRL(costs)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Lucro líquido</div>
          <div className="text-[20px] font-semibold text-[#071A34] tabular-nums mt-1">
            {formatBRL(profit)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Margem líquida</div>
          <div className="text-[20px] font-semibold text-[#9A7220] tabular-nums mt-1">
            {margin}%
          </div>
        </div>
      </div>

      {/* Gráfico limpo de Receita vs Custos */}
      <section className="bg-white border border-[#E4EAF1] rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-[13.5px] font-semibold text-[#071A34]">
              Evolução mensal — Vendas e custos
            </h3>
            <p className="text-[12px] text-[#5A6B82]">
              Comparativo dos últimos 6 meses da operação
            </p>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-[#5A6B82]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#071A34]" />
              Receita
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#C89B3C]" />
              Custos
            </span>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-4 items-end h-44 pt-4">
          {MONTHLY_SERIES.map((item) => {
            const revH = Math.round((item.revenue / maxVal) * 100);
            const costH = Math.round((item.cost / maxVal) * 100);
            return (
              <div key={item.month} className="flex flex-col items-center gap-2 h-full justify-end">
                <div className="w-full max-w-[54px] flex items-end justify-center gap-1.5 h-32">
                  <div
                    className="w-4 rounded-t bg-[#071A34] transition-all"
                    style={{ height: `${revH}%` }}
                    title={`Receita ${item.month}: ${formatBRL(item.revenue)}`}
                  />
                  <div
                    className="w-4 rounded-t bg-[#C89B3C]/80 transition-all"
                    style={{ height: `${costH}%` }}
                    title={`Custos ${item.month}: ${formatBRL(item.cost)}`}
                  />
                </div>
                <span className="text-[11.5px] text-[#5A6B82] font-medium">
                  {item.month}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Ranking de produtos e clientes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EEF2F7]">
            <h3 className="text-[13.5px] font-semibold text-[#071A34]">
              Rentabilidade por produto
            </h3>
          </div>
          <div className="divide-y divide-[#F1F5F9]">
            {PRODUCTS.slice(0, 5).map((p) => {
              const marginPct = Math.round(((p.price - p.cost) / p.price) * 100);
              return (
                <div
                  key={p.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 text-[13px]"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[#0F1E36] truncate">{p.name}</div>
                    <div className="text-[11.5px] text-[#5A6B82]">{p.category}</div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="font-semibold text-[#071A34]">{formatBRL(p.price)}</div>
                    <div className="text-[11.5px] text-emerald-700">Margem {marginPct}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EEF2F7]">
            <h3 className="text-[13.5px] font-semibold text-[#071A34]">
              Principais clientes no período
            </h3>
          </div>
          <div className="divide-y divide-[#F1F5F9]">
            {[...CLIENTS]
              .sort((a, b) => b.totalSpent - a.totalSpent)
              .map((c) => (
                <div
                  key={c.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 text-[13px]"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[#0F1E36] truncate">{c.company}</div>
                    <div className="text-[11.5px] text-[#5A6B82]">
                      {c.ordersCount} pedidos realizados
                    </div>
                  </div>
                  <div className="font-semibold text-[#071A34] tabular-nums shrink-0">
                    {formatBRL(c.totalSpent)}
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}
