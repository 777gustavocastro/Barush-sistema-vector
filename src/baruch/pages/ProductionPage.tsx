import { AlertCircle, CheckCircle2, Clock, LayoutGrid, List, MoreHorizontal, Package, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SelectMenu } from '../components/SelectMenu';
import { formatBRL } from '../data/mockData';
import { ProductThumb } from '../products/ProductVisuals';
import type { CatalogProduct } from '../products/catalogTypes';
import type { ProductionFocus, ProductionOrder, ProductionStatus } from '../types';

interface ProductionPageProps {
  orders: ProductionOrder[];
  onUpdateStatus: (orderId: string, status: ProductionStatus) => void;
  focus?: ProductionFocus | null;
}

type ViewMode = 'kanban' | 'list';
type BoardFilter = 'todos' | 'aguardando' | 'em_producao' | 'pronto' | 'atrasados' | ProductionStatus;
type PriorityFilter = 'todas' | 'normal' | 'alta';
type DeadlineFilter = 'todos' | 'hoje' | 'proximos' | 'atrasados';
type SortKey = 'prazo' | 'entrada' | 'prioridade';

const TODAY = '2026-11-25';
const PAGE_SIZE = 8;

const STATUS_LABEL: Record<ProductionStatus, string> = {
  arte_aprovacao: 'Aguardando arte',
  pre_impressao: 'Pré-impressão',
  producao: 'Em produção',
  acabamento: 'Acabamento',
  pronto: 'Pronto',
};

const COLUMNS: Array<{ id: string; label: string; statuses: ProductionStatus[] }> = [
  { id: 'aguardando', label: 'Aguardando', statuses: ['arte_aprovacao', 'pre_impressao'] },
  { id: 'producao', label: 'Em produção', statuses: ['producao', 'acabamento'] },
  { id: 'pronto', label: 'Pronto', statuses: ['pronto'] },
  { id: 'entregue', label: 'Entregue', statuses: [] },
];

function focusToFilter(focus: ProductionFocus): BoardFilter {
  if (focus === 'aprovacao') return 'arte_aprovacao';
  if (focus === 'em_producao') return 'em_producao';
  if (focus === 'pronto') return 'pronto';
  return 'atrasados';
}

function isLate(order: ProductionOrder): boolean {
  return order.status !== 'pronto' && order.dueDate < TODAY;
}

function isSoon(order: ProductionOrder): boolean {
  return !isLate(order) && order.status !== 'pronto' && order.dueDate <= '2026-11-26';
}

function columnOf(order: ProductionOrder): string {
  return COLUMNS.find((column) => column.statuses.includes(order.status))?.id ?? 'aguardando';
}

function guessCategory(name: string): CatalogProduct['category'] {
  const text = name.toLowerCase();
  if (text.includes('camiseta') || text.includes('polo') || text.includes('uniforme')) return 'Uniformes';
  if (text.includes('laser') || text.includes('acrílico') || text.includes('acrilico')) return 'Personalização a laser';
  if (text.includes('banner') || text.includes('adesivo') || text.includes('wind')) return 'Comunicação visual';
  if (text.includes('caneca') || text.includes('copo')) return 'Personalização';
  if (text.includes('sacola') || text.includes('caixa')) return 'Outros';
  return 'Impressão gráfica';
}

export function ProductionPage({ orders, onUpdateStatus, focus = null }: ProductionPageProps) {
  const [view, setView] = useState<ViewMode>('kanban');
  const [query, setQuery] = useState('');
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('todos');
  const [priority, setPriority] = useState<PriorityFilter>('todas');
  const [deadline, setDeadline] = useState<DeadlineFilter>('todos');
  const [sortKey, setSortKey] = useState<SortKey>('prazo');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<'pedido' | 'arte' | 'tecnico' | 'notas'>('pedido');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setBoardFilter(focus ? focusToFilter(focus) : 'todos');
  }, [focus]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const counts = {
    waiting: orders.filter((order) => columnOf(order) === 'aguardando').length,
    running: orders.filter((order) => columnOf(order) === 'producao').length,
    done: orders.filter((order) => order.status === 'pronto').length,
    late: orders.filter(isLate).length,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = orders.filter((order) => {
      if (q && !`${order.code} ${order.clientName} ${order.productName}`.toLowerCase().includes(q)) return false;
      if (boardFilter === 'aguardando' && columnOf(order) !== 'aguardando') return false;
      if (boardFilter === 'em_producao' && columnOf(order) !== 'producao') return false;
      if (boardFilter === 'pronto' && order.status !== 'pronto') return false;
      if (boardFilter === 'atrasados' && !isLate(order)) return false;
      if (boardFilter !== 'todos' && boardFilter !== 'aguardando' && boardFilter !== 'em_producao' && boardFilter !== 'pronto' && boardFilter !== 'atrasados' && order.status !== boardFilter) return false;
      if (priority !== 'todas' && order.priority !== priority) return false;
      if (deadline === 'hoje' && order.dueDate !== TODAY) return false;
      if (deadline === 'proximos' && !isSoon(order)) return false;
      if (deadline === 'atrasados' && !isLate(order)) return false;
      return true;
    });
    list.sort((a, b) => {
      if (sortKey === 'prioridade') return Number(b.priority === 'alta') - Number(a.priority === 'alta');
      if (sortKey === 'entrada') return b.code.localeCompare(a.code);
      return a.dueDate.localeCompare(b.dueDate);
    });
    return list;
  }, [orders, query, boardFilter, priority, deadline, sortKey]);

  useEffect(() => setPage(1), [query, boardFilter, priority, deadline, sortKey, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = orders.find((order) => order.id === openId) ?? null;

  const changeStatus = (order: ProductionOrder, status: ProductionStatus) => {
    onUpdateStatus(order.id, status);
    setNotice(`${order.code} atualizado para ${STATUS_LABEL[status]}.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">Produção</h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">Acompanhe pedidos, prazos e etapas da gráfica.</p>
        </div>
        <div className="inline-flex h-8 items-center rounded-lg bg-[#EEF2F6] p-0.5">
          <button type="button" aria-label="Visualizar em kanban" onClick={() => setView('kanban')} className={`h-7 w-8 rounded-md inline-flex items-center justify-center ${view === 'kanban' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#8A98AB]'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          <button type="button" aria-label="Visualizar em lista" onClick={() => setView('list')} className={`h-7 w-8 rounded-md inline-flex items-center justify-center ${view === 'list' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#8A98AB]'}`}><List className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Indicator icon={Clock} label="Aguardando" value={counts.waiting} active={boardFilter === 'aguardando'} onClick={() => setBoardFilter('aguardando')} />
        <Indicator icon={Package} label="Em produção" value={counts.running} active={boardFilter === 'em_producao'} onClick={() => setBoardFilter('em_producao')} />
        <Indicator icon={CheckCircle2} label="Prontos" value={counts.done} active={boardFilter === 'pronto'} onClick={() => setBoardFilter('pronto')} />
        <Indicator icon={AlertCircle} label="Atrasados" value={counts.late} active={boardFilter === 'atrasados'} onClick={() => setBoardFilter('atrasados')} />
      </div>

      {notice && <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">{notice}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[180px] flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#8A98AB] absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, pedido ou produto" aria-label="Buscar pedido" className="h-9 w-full rounded-lg border border-[#E4EAF1] bg-white pl-8 pr-3 text-[12.5px] outline-none focus:border-[#C5D0DE]" />
        </label>
        <SelectMenu value={boardFilter} ariaLabel="Filtrar por status" onChange={setBoardFilter} options={[{ value: 'todos', label: 'Todos os status' }, { value: 'aguardando', label: 'Aguardando' }, { value: 'em_producao', label: 'Em produção' }, { value: 'pronto', label: 'Prontos' }, { value: 'atrasados', label: 'Atrasados' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value: value as ProductionStatus, label }))]} />
        <SelectMenu value={priority} ariaLabel="Filtrar por prioridade" onChange={setPriority} options={[{ value: 'todas', label: 'Prioridade' }, { value: 'normal', label: 'Normal' }, { value: 'alta', label: 'Prioritário' }]} />
        <SelectMenu value={deadline} ariaLabel="Filtrar por prazo" onChange={setDeadline} options={[{ value: 'todos', label: 'Prazo' }, { value: 'hoje', label: 'Hoje' }, { value: 'proximos', label: 'Próximos' }, { value: 'atrasados', label: 'Atrasados' }]} />
        <SelectMenu value={sortKey} ariaLabel="Ordenar pedidos" onChange={setSortKey} options={[{ value: 'prazo', label: 'Prazo' }, { value: 'entrada', label: 'Entrada' }, { value: 'prioridade', label: 'Prioridade' }]} />
      </div>

      {orders.length === 0 ? (
        <Empty title="Nenhum pedido em produção" text="Quando uma venda gerar produção, os pedidos aparecem aqui." />
      ) : filtered.length === 0 ? (
        <Empty title="Nenhum pedido encontrado" text="Ajuste a busca ou os filtros para ver outros pedidos." />
      ) : view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((column) => {
            const items = filtered.filter((order) => columnOf(order) === column.id);
            return (
              <section key={column.id} className="min-w-[240px] flex-1">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h3 className="text-[12.5px] font-semibold text-[#071A34]">{column.label}</h3>
                  <span className="text-[11px] text-[#8A98AB]">{items.length}</span>
                </div>
                <div className="space-y-2 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
                  {items.length === 0 ? <p className="px-1 py-6 text-[12px] text-[#8A98AB]">Nenhum pedido.</p> : items.map((order) => (
                    <OrderCard key={order.id} order={order} onOpen={() => { setOpenId(order.id); setTab('pedido'); }} onStatus={(status) => changeStatus(order, status)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-[#EEF2F7] text-[11.5px] text-[#5A6B82]">
                <th className="py-2.5 pr-3 font-medium">Pedido</th>
                <th className="py-2.5 pr-3 font-medium">Cliente</th>
                <th className="py-2.5 pr-3 font-medium">Produto</th>
                <th className="py-2.5 pr-3 font-medium text-right">Qtd.</th>
                <th className="py-2.5 pr-3 font-medium">Prazo</th>
                <th className="py-2.5 pr-3 font-medium">Prioridade</th>
                <th className="py-2.5 pr-3 font-medium">Status</th>
                <th className="py-2.5 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
              {visible.map((order) => (
                <tr key={order.id} className={isLate(order) ? 'bg-amber-50/40' : ''}>
                  <td className="py-2.5 pr-3 font-medium text-[#071A34]">{order.code}</td>
                  <td className="py-2.5 pr-3">{order.clientName}</td>
                  <td className="py-2.5 pr-3 max-w-[220px] truncate text-[#5A6B82]">{order.productName}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{order.quantity}</td>
                  <td className={`py-2.5 pr-3 whitespace-nowrap ${isLate(order) ? 'text-amber-800' : 'text-[#5A6B82]'}`}>{order.dueLabel}</td>
                  <td className="py-2.5 pr-3">{order.priority === 'alta' ? 'Prioritário' : 'Normal'}</td>
                  <td className="py-2.5 pr-3">{STATUS_LABEL[order.status]}</td>
                  <td className="py-2.5"><button type="button" onClick={() => { setOpenId(order.id); setTab('pedido'); }} className="text-[12px] text-[#071A34]">Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-[12px] text-[#5A6B82]">
              <span>Página {page} de {pageCount}</span>
              <div className="flex gap-1">
                <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="h-8 px-2 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40">Anterior</button>
                <button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} className="h-8 px-2 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40">Próxima</button>
              </div>
            </div>
          )}
        </div>
      )}

      {selected && (
        <OrderDrawer
          order={selected}
          tab={tab}
          onTab={setTab}
          onClose={() => setOpenId(null)}
          onStatus={(status) => changeStatus(selected, status)}
        />
      )}
    </div>
  );
}

function Indicator({ icon: Icon, label, value, active, onClick }: { icon: typeof Clock; label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-2 rounded-lg px-1 py-1 ${active ? 'text-[#071A34]' : 'text-[#5A6B82]'}`}>
      <Icon className="w-4 h-4" strokeWidth={1.75} />
      <span className="text-left"><span className="block text-[16px] font-semibold leading-none tabular-nums text-[#071A34]">{value}</span><span className="text-[11.5px]">{label}</span></span>
    </button>
  );
}

function OrderCard({ order, onOpen, onStatus }: { order: ProductionOrder; onOpen: () => void; onStatus: (status: ProductionStatus) => void }) {
  const late = isLate(order);
  const category = guessCategory(order.productName);
  return (
    <article className={`rounded-xl border bg-white p-2.5 ${late ? 'border-amber-200' : 'border-[#E7EDF3]'}`}>
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex gap-2">
          <ProductThumb product={{ name: order.productName, category, image: null }} className="h-12 w-12 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-[#8A98AB]">{order.code}</span>
              {order.priority === 'alta' && <span className="text-[10.5px] text-[#9A7220]">Prioritário</span>}
            </div>
            <div className="text-[12.5px] font-semibold text-[#071A34] truncate">{order.clientName}</div>
            <div className="text-[11.5px] text-[#5A6B82] truncate">{order.quantity}× {order.productName}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className={late ? 'text-amber-800' : isSoon(order) ? 'text-[#9A7220]' : 'text-[#8A98AB]'}>{late ? 'Atrasado · ' : ''}{order.dueLabel}</span>
          {order.status === 'arte_aprovacao' && <span className="text-[#5A6B82]">Aprovar arte</span>}
        </div>
      </button>
      <div className="mt-2">
        <SelectMenu value={order.status} ariaLabel={`Status de ${order.code}`} className="w-full max-w-none" onChange={onStatus} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value: value as ProductionStatus, label }))} />
      </div>
    </article>
  );
}

function OrderDrawer({ order, tab, onTab, onClose, onStatus }: { order: ProductionOrder; tab: 'pedido' | 'arte' | 'tecnico' | 'notas'; onTab: (tab: 'pedido' | 'arte' | 'tecnico' | 'notas') => void; onClose: () => void; onStatus: (status: ProductionStatus) => void }) {
  const category = guessCategory(order.productName);
  const specs = specsFromName(order.productName);
  const tabs = [
    { id: 'pedido' as const, label: 'Pedido' },
    { id: 'arte' as const, label: 'Arte' },
    { id: 'tecnico' as const, label: 'Técnico' },
    { id: 'notas' as const, label: 'Observações' },
  ];
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" className="absolute inset-0 bg-[#071A34]/20" aria-label="Fechar pedido" onClick={onClose} />
      <aside className="relative h-full w-full max-w-md bg-white border-l border-[#E4EAF1] flex flex-col">
        <div className="px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-[#071A34]">{order.code}</h3>
            <p className="text-[12.5px] text-[#5A6B82]">{order.clientName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar"><X className="w-4 h-4 text-[#8A98AB]" /></button>
        </div>
        <div className="px-5 flex gap-1">
          {tabs.map((item) => <button key={item.id} type="button" onClick={() => onTab(item.id)} className={`h-8 px-3 rounded-lg text-[12.5px] ${tab === item.id ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'}`}>{item.label}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-[12.5px]">
          {tab === 'pedido' && (
            <dl className="grid grid-cols-2 gap-3">
              <Info label="Produto" value={order.productName} />
              <Info label="Quantidade" value={String(order.quantity)} />
              <Info label="Prazo" value={order.dueLabel} />
              <Info label="Prioridade" value={order.priority === 'alta' ? 'Prioritário' : 'Normal'} />
              <Info label="Status" value={STATUS_LABEL[order.status]} />
              <Info label="Valor" value={formatBRL(order.value)} />
            </dl>
          )}
          {tab === 'arte' && (
            <div className="space-y-2">
              <ProductThumb product={{ name: order.productName, category, image: null }} className="h-40 w-full rounded-xl" />
              <p className="text-[#5A6B82]">A arte final e os arquivos de referência aparecem aqui quando estiverem vinculados ao pedido.</p>
            </div>
          )}
          {tab === 'tecnico' && (
            specs.length === 0 ? <p className="text-[#8A98AB]">Sem especificações extras para este produto.</p> : (
              <dl className="grid grid-cols-2 gap-3">{specs.map((item) => <Info key={item.label} label={item.label} value={item.value} />)}</dl>
            )
          )}
          {tab === 'notas' && (
            <div className="space-y-2 text-[#334155]">
              <p>{order.status === 'arte_aprovacao' ? 'Aguardando aprovação da arte antes de produzir.' : 'Sem observações adicionais do cliente.'}</p>
              <p className="text-[#8A98AB]">Histórico: pedido entrou em {STATUS_LABEL[order.status]}.</p>
            </div>
          )}
        </div>
        <div className="px-5 py-3 flex flex-wrap justify-end gap-2">
          {columnOf(order) === 'aguardando' && <button type="button" onClick={() => onStatus('producao')} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Iniciar produção</button>}
          {order.status !== 'pronto' && <button type="button" onClick={() => onStatus('pronto')} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">Marcar como pronto</button>}
          <button type="button" disabled className="h-9 px-3 rounded-lg text-[12.5px] text-[#8A98AB]" title="A entrega será registrada quando o status existir no fluxo">Marcar como entregue</button>
        </div>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[11px] text-[#8A98AB]">{label}</dt><dd className="text-[#071A34] mt-0.5">{value}</dd></div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="py-16 text-center"><MoreHorizontal className="w-5 h-5 mx-auto text-[#8A98AB]" /><h3 className="mt-3 text-[14px] font-semibold text-[#071A34]">{title}</h3><p className="mt-1 text-[12.5px] text-[#5A6B82]">{text}</p></div>;
}

function specsFromName(name: string): Array<{ label: string; value: string }> {
  const text = name.toLowerCase();
  const specs: Array<{ label: string; value: string }> = [];
  if (text.includes('couchê') || text.includes('couche')) specs.push({ label: 'Material', value: 'Couchê' });
  if (text.includes('lona')) specs.push({ label: 'Material', value: 'Lona' });
  if (text.includes('kraft')) specs.push({ label: 'Material', value: 'Kraft' });
  if (text.includes('sublim')) specs.push({ label: 'Impressão', value: 'Sublimação' });
  if (text.includes('hot stamping')) specs.push({ label: 'Acabamento', value: 'Hot stamping' });
  if (text.includes('recorte')) specs.push({ label: 'Acabamento', value: 'Recorte' });
  return specs;
}
