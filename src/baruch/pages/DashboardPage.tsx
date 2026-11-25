import {
  ArrowUpRight,
  CalendarClock,
  FolderOpen,
  MessageSquareText,
  Plus,
  ShoppingBag,
} from 'lucide-react';
import { formatBRL } from '../data/mockData';
import type { NavPageId, ProductionOrder, SaleRecord } from '../types';

interface DashboardPageProps {
  orders: ProductionOrder[];
  sales: SaleRecord[];
  monthlyExpenses: number;
  onNavigate: (page: NavPageId) => void;
}

const STATUS_LABELS: Record<ProductionOrder['status'], { label: string; dot: string }> = {
  arte_aprovacao: { label: 'Arte / Aprovação', dot: 'bg-amber-500' },
  pre_impressao: { label: 'Pré-impressão', dot: 'bg-sky-500' },
  producao: { label: 'Em produção', dot: 'bg-[#071A34]' },
  acabamento: { label: 'Acabamento', dot: 'bg-[#C89B3C]' },
  pronto: { label: 'Pronto', dot: 'bg-emerald-600' },
};

export function DashboardPage({
  orders,
  sales,
  monthlyExpenses,
  onNavigate,
}: DashboardPageProps) {
  const totalRevenue = 42680 + sales.reduce((acc, s) => acc + s.total, 0);
  const activeProductionCount = orders.filter((o) => o.status !== 'pronto').length;
  const readyCount = orders.filter((o) => o.status === 'pronto').length;
  const estimatedProfit = totalRevenue - monthlyExpenses - 14200;
  const marginPct = Math.round((estimatedProfit / Math.max(1, totalRevenue)) * 100);

  return (
    <div className="space-y-6">
      {/* Cabeçalho discreto da visão geral */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Visão geral da operação
          </h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Acompanhamento de vendas, produção em andamento e entregas programadas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('chat_projects')}
            className="h-8 px-3 rounded-md border border-[#DCE3EC] bg-white text-[#0F1E36] text-[12.5px] font-medium hover:bg-[#F8FAFC] transition-colors inline-flex items-center gap-1.5"
          >
            <MessageSquareText className="w-3.5 h-3.5 text-[#5A6B82]" strokeWidth={1.75} />
            Novo projeto
          </button>
          <button
            type="button"
            onClick={() => onNavigate('sales')}
            className="h-8 px-3.5 rounded-md bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5 text-[#E3C16F]" strokeWidth={2} />
            Nova venda (PDV)
          </button>
        </div>
      </div>

      {/* Faixa de indicadores (limpa, sem excesso de cartões separados) */}
      <div className="bg-white border border-[#E4EAF1] rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#EEF2F7]">
        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Faturamento (mês)</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[20px] font-semibold text-[#071A34] tabular-nums tracking-[-0.02em]">
              {formatBRL(totalRevenue)}
            </span>
            <span className="text-[11.5px] font-medium text-emerald-700">+12,4%</span>
          </div>
          <div className="text-[11.5px] text-slate-400 mt-1">
            {sales.length + 38} vendas confirmadas no período
          </div>
        </div>

        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Lucro líquido estimado</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[20px] font-semibold text-[#071A34] tabular-nums tracking-[-0.02em]">
              {formatBRL(estimatedProfit)}
            </span>
            <span className="text-[11.5px] font-medium text-[#9A7220] tabular-nums">
              Margem {marginPct}%
            </span>
          </div>
          <div className="text-[11.5px] text-slate-400 mt-1">
            Despesas operacionais: {formatBRL(monthlyExpenses)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Pedidos em produção</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[20px] font-semibold text-[#071A34] tabular-nums tracking-[-0.02em]">
              {activeProductionCount}
            </span>
            <span className="text-[11.5px] font-medium text-[#5A6B82]">
              {readyCount} pronto(s)
            </span>
          </div>
          <div className="text-[11.5px] text-slate-400 mt-1">
            2 entregas prioritárias nas próximas 24h
          </div>
        </div>

        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Ticket médio</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[20px] font-semibold text-[#071A34] tabular-nums tracking-[-0.02em]">
              {formatBRL(totalRevenue / Math.max(1, sales.length + 38))}
            </span>
            <span className="text-[11.5px] font-medium text-emerald-700">+4,1%</span>
          </div>
          <div className="text-[11.5px] text-slate-400 mt-1">
            Impressos, personalizados e comunicação visual
          </div>
        </div>
      </div>

      {/* Área operacional principal: Fila de produção + Últimas vendas e atalhos */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Pedidos em andamento */}
        <section className="xl:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-[#071A34]" strokeWidth={1.75} />
              <h3 className="text-[13.5px] font-semibold text-[#071A34]">
                Produção e próximas entregas
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('production')}
              className="text-[12px] font-medium text-[#5A6B82] hover:text-[#071A34] inline-flex items-center gap-1"
            >
              Ver agenda
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#EEF2F7] text-[11.5px] font-medium text-[#5A6B82] bg-[#FAFBFD]">
                  <th className="py-2.5 px-4">Pedido</th>
                  <th className="py-2.5 px-4">Cliente / Item</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Prazo</th>
                  <th className="py-2.5 px-4 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
                {orders.map((order) => {
                  const st = STATUS_LABELS[order.status];
                  return (
                    <tr
                      key={order.id}
                      onClick={() => onNavigate('production')}
                      className="hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4 font-mono text-[12px] text-[#071A34] font-medium whitespace-nowrap">
                        {order.code}
                      </td>
                      <td className="py-2.5 px-4 min-w-[200px]">
                        <div className="font-medium text-[#0F1E36] truncate">
                          {order.clientName}
                        </div>
                        <div className="text-[12px] text-[#5A6B82] truncate">
                          {order.quantity}× {order.productName}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-[#334155]">
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                          {st.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-[12.5px] text-[#5A6B82]">
                        <span className={order.priority === 'alta' ? 'text-[#9A7220] font-medium' : ''}>
                          {order.dueLabel}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-medium text-[#0F1E36] whitespace-nowrap">
                        {formatBRL(order.value)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </section>

        {/* Coluna lateral: Vendas recentes + Acessos diretos */}
        <div className="space-y-5">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-[#071A34]" strokeWidth={1.75} />
                <h3 className="text-[13.5px] font-semibold text-[#071A34]">
                  Vendas recentes
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('sales')}
                className="text-[12px] font-medium text-[#5A6B82] hover:text-[#071A34] inline-flex items-center gap-1"
              >
                Abrir PDV
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden divide-y divide-[#F1F5F9]">
              {sales.slice(0, 4).map((sale) => (
                <div
                  key={sale.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[#0F1E36] truncate">
                      {sale.clientName}
                    </div>
                    <div className="text-[11.5px] text-[#5A6B82] truncate">
                      {sale.code} · {sale.paymentMethod} · {sale.date}
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold text-[#071A34] tabular-nums shrink-0">
                    {formatBRL(sale.total)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#5A6B82] mb-2">
              Acesso rápido
            </div>
            <div className="bg-white border border-[#E4EAF1] rounded-lg p-2 space-y-1">
              <button
                type="button"
                onClick={() => onNavigate('chat_projects')}
                className="w-full px-3 py-2 rounded-md text-left hover:bg-[#F6F8FB] transition-colors flex items-center justify-between text-[13px] text-[#0F1E36]"
              >
                <span className="inline-flex items-center gap-2">
                  <MessageSquareText className="w-4 h-4 text-[#9A7220]" strokeWidth={1.75} />
                  Criar ou revisar arte com IA
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('files')}
                className="w-full px-3 py-2 rounded-md text-left hover:bg-[#F6F8FB] transition-colors flex items-center justify-between text-[13px] text-[#0F1E36]"
              >
                <span className="inline-flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-[#071A34]" strokeWidth={1.75} />
                  Biblioteca de artes e SVGs
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
