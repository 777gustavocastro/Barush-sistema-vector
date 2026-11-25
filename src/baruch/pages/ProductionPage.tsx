import { Calendar, CheckCircle2, Clock } from 'lucide-react';
import { useState } from 'react';
import { formatBRL } from '../data/mockData';
import type { ProductionOrder, ProductionStatus } from '../types';

interface ProductionPageProps {
  orders: ProductionOrder[];
  onUpdateStatus: (orderId: string, status: ProductionStatus) => void;
}

const STAGES: Array<{ id: ProductionStatus; label: string }> = [
  { id: 'arte_aprovacao', label: 'Arte / Aprovação' },
  { id: 'pre_impressao', label: 'Pré-impressão' },
  { id: 'producao', label: 'Produção' },
  { id: 'acabamento', label: 'Acabamento' },
  { id: 'pronto', label: 'Pronto' },
];

export function ProductionPage({ orders, onUpdateStatus }: ProductionPageProps) {
  const [stageFilter, setStageFilter] = useState<'todos' | ProductionStatus>('todos');

  const filtered = orders.filter(
    (o) => stageFilter === 'todos' || o.status === stageFilter
  );

  // Agrupamento simples por data de entrega para agenda
  const groupedByDate = filtered.reduce<Record<string, ProductionOrder[]>>((acc, order) => {
    const key = order.dueDate;
    if (!acc[key]) acc[key] = [];
    acc[key].push(order);
    return acc;
  }, {});

  const sortedDates = Object.keys(groupedByDate).sort();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Produção e agenda de entregas
          </h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Controle de etapas de impressão, prazos e calendário diário de expedição.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStageFilter('todos')}
            className={`h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${
              stageFilter === 'todos'
                ? 'bg-[#071A34] text-white'
                : 'bg-white border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34]'
            }`}
          >
            Todos ({orders.length})
          </button>
          {STAGES.map((stage) => {
            const count = orders.filter((o) => o.status === stage.id).length;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => setStageFilter(stage.id)}
                className={`h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${
                  stageFilter === stage.id
                    ? 'bg-[#071A34] text-white'
                    : 'bg-white border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34]'
                }`}
              >
                {stage.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabela de produção com alteração direta de status */}
      <section className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
                <th className="py-2.5 px-4">OS</th>
                <th className="py-2.5 px-4">Cliente / Serviço</th>
                <th className="py-2.5 px-4">Prazo</th>
                <th className="py-2.5 px-4">Etapa atual</th>
                <th className="py-2.5 px-4 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
              {filtered.map((order) => (
                <tr key={order.id} className="hover:bg-[#F8FAFC]">
                  <td className="py-3 px-4 font-mono text-[12px] font-medium text-[#071A34] whitespace-nowrap">
                    {order.code}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-[#0F1E36]">{order.clientName}</div>
                    <div className="text-[12px] text-[#5A6B82]">
                      {order.quantity}× {order.productName}
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-[12.5px]">
                    <span
                      className={`inline-flex items-center gap-1.5 ${
                        order.priority === 'alta'
                          ? 'text-[#9A7220] font-medium'
                          : 'text-[#5A6B82]'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      {order.dueLabel}
                    </span>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <select
                      value={order.status}
                      onChange={(e) =>
                        onUpdateStatus(order.id, e.target.value as ProductionStatus)
                      }
                      aria-label={`Etapa do pedido ${order.code}`}
                      className="h-8 px-2.5 rounded-md bg-[#F6F8FB] border border-[#DCE3EC] text-[12.5px] text-[#071A34] font-medium focus:outline-none focus:bg-white focus:border-[#071A34]"
                    >
                      {STAGES.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-semibold text-[#071A34] whitespace-nowrap">
                    {formatBRL(order.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Calendário / Agenda de entregas */}
      <section className="bg-white border border-[#E4EAF1] rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4 text-[#071A34]" strokeWidth={1.75} />
          <h3 className="text-[13.5px] font-semibold text-[#071A34]">
            Calendário de entregas programadas
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {sortedDates.map((dateStr) => {
            const list = groupedByDate[dateStr];
            const formattedDate = new Date(`${dateStr}T12:00:00`).toLocaleDateString(
              'pt-BR',
              { weekday: 'short', day: '2-digit', month: 'short' }
            );
            return (
              <div
                key={dateStr}
                className="rounded-md border border-[#E4EAF1] bg-[#FAFBFD] p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between border-b border-[#EEF2F7] pb-2">
                  <span className="text-[12.5px] font-semibold text-[#071A34] capitalize">
                    {formattedDate}
                  </span>
                  <span className="text-[11px] font-medium text-[#5A6B82]">
                    {list.length} entrega(s)
                  </span>
                </div>
                <div className="space-y-2">
                  {list.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white border border-[#E4EAF1] rounded px-2.5 py-2 text-[12px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-[#071A34] font-medium">
                          {item.code}
                        </span>
                        {item.status === 'pronto' && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                      </div>
                      <div className="font-medium text-[#0F1E36] truncate mt-0.5">
                        {item.clientName}
                      </div>
                      <div className="text-[#5A6B82] truncate">{item.productName}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
