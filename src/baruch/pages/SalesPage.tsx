import { CheckCircle2, Minus, Plus, Search, ShoppingBag, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { blankClient, saveClient } from '../clients/clientStore';
import { CLIENTS, PRODUCTS, formatBRL } from '../data/mockData';
import { loadCatalog } from '../products/catalogStore';
import type { CatalogProduct } from '../products/catalogTypes';
import { lineGross, lineNet, money, quoteSale } from '../sales/saleMath';
import type { SaleLineSnapshot, StoredSale } from '../sales/saleTypes';
import { loadSales, saveStoredSale, subscribeSales, updateStoredSale } from '../sales/salesStore';
import type { ClientRecord, ProductionOrder, SaleRecord } from '../types';

interface SalesPageProps {
  sales: SaleRecord[];
  onRegisterSale: (sale: SaleRecord) => void;
  clients?: ClientRecord[];
}

interface CartItem extends SaleLineSnapshot {}

type PayMethod = SaleRecord['paymentMethod'];
type Screen = 'pos' | 'history';

const PAYMENTS: PayMethod[] = ['Dinheiro', 'PIX', 'Cartão de débito', 'Cartão de crédito', 'Transferência', 'Boleto'];

export function SalesPage({ onRegisterSale: _onRegisterSale, clients }: SalesPageProps) {
  const directory = clients && clients.length > 0 ? clients : CLIENTS;
  const [screen, setScreen] = useState<Screen>('pos');
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [records, setRecords] = useState<StoredSale[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clientId, setClientId] = useState<string | null>(directory[0]?.id ?? null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState('');
  const [discountMode, setDiscountMode] = useState<'valor' | 'percent'>('valor');
  const [discountRaw, setDiscountRaw] = useState('');
  const [additionRaw, setAdditionRaw] = useState('');
  const [payment, setPayment] = useState<PayMethod>('PIX');
  const [receiveNow, setReceiveNow] = useState(true);
  const [split, setSplit] = useState(false);
  const [secondPayment, setSecondPayment] = useState<PayMethod>('Dinheiro');
  const [secondAmount, setSecondAmount] = useState('');
  const [cashPaid, setCashPaid] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [receipt, setReceipt] = useState<StoredSale | null>(null);
  const [saving, setSaving] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyStatus, setHistoryStatus] = useState<'todas' | 'finalizada' | 'cancelada' | 'pendente'>('todas');
  const [historyPay, setHistoryPay] = useState<'todas' | PayMethod>('todas');
  const [selectedSale, setSelectedSale] = useState<StoredSale | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const lock = useRef(false);

  useEffect(() => {
    loadCatalog().then((items) => setCatalog(items.filter((item) => item.status === 'ativo'))).catch((error: unknown) => {
      setCatalogError(error instanceof Error ? error.message : 'Não foi possível carregar o catálogo.');
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => loadSales().then((items) => { if (alive) setRecords(items); }).catch(() => undefined);
    refresh();
    const unsubscribe = subscribeSales(refresh);
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const products = catalog.length > 0
    ? catalog.map((item) => ({ id: item.id, name: item.name, category: item.category, price: item.price, unit: item.saleUnit }))
    : PRODUCTS.map((item) => ({ id: item.id, name: item.name, category: item.category, price: item.price, unit: 'unidade' }));

  const foundProducts = products.filter((product) => {
    const q = productQuery.trim().toLowerCase();
    return !q || product.name.toLowerCase().includes(q) || product.category.toLowerCase().includes(q);
  });
  const foundClients = directory.filter((client) => {
    const q = clientQuery.trim().toLowerCase();
    return !q || `${client.company} ${client.name} ${client.phone}`.toLowerCase().includes(q);
  }).slice(0, 5);
  const selectedClient = directory.find((client) => client.id === clientId) ?? null;
  const generalDiscount = discountMode === 'percent'
    ? quoteSale(cart, 0, 0).subtotal * ((Number(discountRaw.replace(',', '.')) || 0) / 100)
    : Number(discountRaw.replace(',', '.')) || 0;
  const quote = quoteSale(cart, generalDiscount, Number(additionRaw.replace(',', '.')) || 0);
  const paidSecond = split ? Math.min(quote.total, Math.max(0, Number(secondAmount.replace(',', '.')) || 0)) : 0;
  const cashTendered = Number(cashPaid.replace(',', '.')) || 0;

  const addProduct = (productId: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    setCart((current) => {
      const price = product.price ?? 0;
      const existing = current.find((item) => item.productId === productId && item.unitPrice === price);
      if (existing) return current.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { productId, name: product.name, category: product.category, unit: product.unit, quantity: 1, unitPrice: price, catalogPrice: price, discount: 0 }];
    });
  };

  const finalize = async () => {
    if (lock.current || saving) return;
    if (cart.length === 0) {
      setNotice({ tone: 'err', text: 'Adicione ao menos um item para finalizar a venda.' });
      return;
    }
    if (cart.some((item) => item.quantity < 1 || item.unitPrice < 0 || item.discount < 0 || item.discount > lineGross(item))) {
      setNotice({ tone: 'err', text: 'Revise quantidades, preços e descontos dos itens.' });
      return;
    }
    if (quote.discount > quote.subtotal) {
      setNotice({ tone: 'err', text: 'O desconto não pode ser maior que o subtotal.' });
      return;
    }
    lock.current = true;
    setSaving(true);
    try {
      const payments = buildPayments(quote.total, receiveNow, payment, split, secondPayment, paidSecond, cashTendered);
      const received = money(payments.reduce((sum, item) => sum + item.amount, 0));
      const pending = money(Math.max(0, quote.total - received));
      const now = new Date();
      const id = `sal-${now.getTime()}`;
      const code = nextCode(records);
      const due = new Date(now);
      due.setDate(due.getDate() + 2);
      const productionOrders: ProductionOrder[] = cart.map((line, index) => ({
        id: `ord-${id}-${index}`,
        code,
        clientId: selectedClient?.id ?? 'avulso',
        clientName: selectedClient?.company ?? 'Sem cliente',
        productName: line.name,
        quantity: line.quantity,
        dueDate: due.toISOString().slice(0, 10),
        dueLabel: 'Em 2 dias',
        status: 'arte_aprovacao',
        priority: 'normal',
        value: lineNet(line),
      }));
      const sale: StoredSale = {
        id,
        code,
        createdAt: now.toISOString(),
        dateLabel: 'Agora',
        clientId: selectedClient?.id ?? null,
        clientName: selectedClient?.company ?? 'Sem cliente',
        lines: cart.map((line) => ({ ...line, unitPrice: money(line.unitPrice), discount: money(line.discount), quantity: line.quantity })),
        notes: notes.trim(),
        subtotal: quote.subtotal,
        discount: quote.discount,
        addition: quote.addition,
        total: quote.total,
        payments,
        received,
        pending,
        paymentStatus: pending === 0 ? 'pago' : received === 0 ? 'pendente' : 'parcial',
        status: 'finalizada',
        productionOrders,
      };
      await saveStoredSale(sale);
      setReceipt(sale);
      setCart([]);
      setNotes('');
      setDiscountRaw('');
      setAdditionRaw('');
      setCashPaid('');
      setSecondAmount('');
      setSplit(false);
      setNotice({ tone: 'ok', text: 'Venda registrada.' });
    } catch (error) {
      setNotice({ tone: 'err', text: error instanceof Error ? error.message : 'Não foi possível registrar a venda.' });
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };

  const createClient = async () => {
    if (!newCompany.trim()) {
      setNotice({ tone: 'err', text: 'Informe o nome ou a razão social do cliente.' });
      return;
    }
    const client = { ...blankClient(), kind: 'pj' as const, company: newCompany.trim(), name: newCompany.trim(), phone: newPhone.trim() };
    await saveClient(client);
    setClientId(client.id);
    setNewClientOpen(false);
    setNewCompany('');
    setNewPhone('');
    setNotice({ tone: 'ok', text: 'Cliente cadastrado e vinculado à venda.' });
  };

  const cancelSale = async () => {
    if (!selectedSale || !cancelReason.trim()) {
      setNotice({ tone: 'err', text: 'Informe o motivo do cancelamento.' });
      return;
    }
    await updateStoredSale({ ...selectedSale, status: 'cancelada', cancelReason: cancelReason.trim(), cancelledAt: new Date().toISOString() });
    setSelectedSale(null);
    setCancelReason('');
    setNotice({ tone: 'ok', text: 'Venda cancelada. O recebimento não foi estornado automaticamente.' });
  };

  const filteredHistory = records.filter((sale) => {
    const q = historyQuery.trim().toLowerCase();
    if (q && !`${sale.code} ${sale.clientName} ${sale.lines.map((line) => line.name).join(' ')}`.toLowerCase().includes(q)) return false;
    if (historyStatus === 'pendente' && sale.pending <= 0) return false;
    if (historyStatus === 'finalizada' && sale.status !== 'finalizada') return false;
    if (historyStatus === 'cancelada' && sale.status !== 'cancelada') return false;
    if (historyPay !== 'todas' && !sale.payments.some((item) => item.method === historyPay) && sale.payments[0]?.method !== historyPay) return false;
    return true;
  });

  const change = payment === 'Dinheiro' && receiveNow ? Math.max(0, cashTendered - (quote.total - paidSecond)) : 0;
  const remaining = receiveNow ? Math.max(0, quote.total - paidSecond - (payment === 'Dinheiro' ? Math.min(quote.total - paidSecond, cashTendered) : quote.total - paidSecond)) : quote.total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">{screen === 'pos' ? 'Nova venda' : 'Vendas'}</h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">Registre e consulte as vendas da gráfica.</p>
        </div>
        <div className="inline-flex h-8 items-center rounded-lg bg-[#EEF2F6] p-0.5">
          <button type="button" onClick={() => setScreen('pos')} className={`h-7 px-3 rounded-md text-[12.5px] ${screen === 'pos' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#5A6B82]'}`}>Nova venda</button>
          <button type="button" onClick={() => setScreen('history')} className={`h-7 px-3 rounded-md text-[12.5px] ${screen === 'history' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#5A6B82]'}`}>Vendas anteriores</button>
        </div>
      </div>

      {notice && <div role="status" className={`rounded-lg px-3 py-2 text-[12.5px] ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{notice.text}</div>}
      {catalogError && <div className="rounded-lg px-3 py-2 text-[12.5px] bg-rose-50 text-rose-800">{catalogError}</div>}

      {screen === 'history' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Número, cliente ou produto" aria-label="Buscar venda" className="h-9 min-w-[200px] flex-1 rounded-lg border border-[#E4EAF1] px-3 text-[12.5px]" />
            <select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value as typeof historyStatus)} aria-label="Status da venda" className="h-9 rounded-lg border border-[#E4EAF1] px-2 text-[12.5px]">
              <option value="todas">Todos os status</option>
              <option value="finalizada">Finalizadas</option>
              <option value="pendente">Pagamento pendente</option>
              <option value="cancelada">Canceladas</option>
            </select>
            <select value={historyPay} onChange={(event) => setHistoryPay(event.target.value as typeof historyPay)} aria-label="Forma de pagamento" className="h-9 rounded-lg border border-[#E4EAF1] px-2 text-[12.5px]">
              <option value="todas">Todos os pagamentos</option>
              {PAYMENTS.map((method) => <option key={method}>{method}</option>)}
            </select>
          </div>
          {filteredHistory.length === 0 ? <p className="py-12 text-center text-[12.5px] text-[#8A98AB]">Nenhuma venda encontrada.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead><tr className="border-b border-[#EEF2F7] text-[11.5px] text-[#5A6B82]"><th className="py-2.5 pr-3 font-medium">Venda</th><th className="py-2.5 pr-3 font-medium">Cliente</th><th className="py-2.5 pr-3 font-medium">Itens</th><th className="py-2.5 pr-3 font-medium">Pagamento</th><th className="py-2.5 pr-3 font-medium">Status</th><th className="py-2.5 font-medium text-right">Total</th></tr></thead>
                <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
                  {filteredHistory.map((sale) => (
                    <tr key={sale.id} onClick={() => { setSelectedSale(sale); setCancelReason(''); }} className="cursor-pointer hover:bg-[#F8FAFC]">
                      <td className="py-2.5 pr-3 font-medium text-[#071A34]">{sale.code}<div className="text-[11px] font-normal text-[#8A98AB]">{sale.dateLabel}</div></td>
                      <td className="py-2.5 pr-3">{sale.clientName}</td>
                      <td className="py-2.5 pr-3 text-[#5A6B82] max-w-[220px] truncate">{sale.lines.map((line) => `${line.quantity}× ${line.name}`).join(', ')}</td>
                      <td className="py-2.5 pr-3">{sale.paymentStatus === 'pago' ? 'Pago' : sale.paymentStatus === 'parcial' ? 'Parcial' : 'Pendente'}</td>
                      <td className="py-2.5 pr-3">{sale.status === 'cancelada' ? 'Cancelada' : 'Finalizada'}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">{formatBRL(sale.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
          <section className="min-w-0 space-y-3">
            <label className="relative block">
              <Search className="w-3.5 h-3.5 text-[#8A98AB] absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Buscar produto por nome ou categoria" aria-label="Buscar produto" className="h-9 w-full rounded-lg border border-[#E4EAF1] bg-white pl-8 pr-3 text-[12.5px] outline-none focus:border-[#C5D0DE]" />
            </label>
            {foundProducts.length === 0 ? <p className="py-10 text-center text-[12.5px] text-[#8A98AB]">Nenhum produto encontrado.</p> : (
              <div className="divide-y divide-[#F1F5F9]">
                {foundProducts.map((product) => (
                  <div key={product.id} className="py-2.5 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-[#F4F7FB] text-[10px] font-semibold text-[#071A34] inline-flex items-center justify-center shrink-0">{product.category.slice(0, 2).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#071A34] truncate">{product.name}</div>
                      <div className="text-[11.5px] text-[#5A6B82]">{product.category} · {product.unit}{product.price === null ? ' · sob consulta' : ''}</div>
                    </div>
                    <div className="text-[13px] font-semibold text-[#071A34] tabular-nums shrink-0">{product.price === null ? '—' : formatBRL(product.price)}</div>
                    <button type="button" onClick={() => addProduct(product.id)} className="h-8 px-2.5 rounded-lg border border-[#E4EAF1] text-[12px] text-[#071A34] hover:bg-[#F6F8FB] inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Adicionar</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="xl:sticky xl:top-4 space-y-4 rounded-2xl border border-[#E7EDF3] bg-white p-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-medium text-[#5A6B82]">Cliente</span>
                <button type="button" onClick={() => setClientId(null)} className="text-[11.5px] text-[#5A6B82] hover:text-[#071A34]">Sem cliente</button>
              </div>
              <input value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" className="h-9 w-full rounded-lg border border-[#E4EAF1] px-3 text-[12.5px] outline-none focus:border-[#C5D0DE]" />
              {clientQuery.trim() && (
                <div className="mt-1 rounded-lg border border-[#E4EAF1] overflow-hidden">
                  {foundClients.length === 0 ? <p className="px-3 py-2 text-[12px] text-[#8A98AB]">Nenhum cliente encontrado.</p> : foundClients.map((client) => (
                    <button key={client.id} type="button" onClick={() => { setClientId(client.id); setClientQuery(''); }} className="w-full px-3 py-2 text-left text-[12.5px] hover:bg-[#F6F8FB]"><span className="block text-[#071A34]">{client.company}</span><span className="text-[11px] text-[#5A6B82]">{client.name}</span></button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-2 text-[12.5px]">
                <span className="flex items-center gap-2 min-w-0"><UserRound className="w-3.5 h-3.5 text-[#8A98AB]" /><span className="truncate text-[#071A34]">{selectedClient ? selectedClient.company : 'Venda sem cliente'}</span></span>
                <button type="button" onClick={() => setNewClientOpen((value) => !value)} className="text-[11.5px] text-[#071A34] shrink-0">Novo</button>
              </div>
              {newClientOpen && (
                <div className="mt-2 space-y-1.5">
                  <input value={newCompany} onChange={(event) => setNewCompany(event.target.value)} placeholder="Nome ou razão social" aria-label="Nome do novo cliente" className="h-8 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px]" />
                  <input value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="Telefone" aria-label="Telefone do novo cliente" className="h-8 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px]" />
                  <button type="button" onClick={() => void createClient()} className="h-8 px-2.5 rounded-lg bg-[#071A34] text-white text-[12px]">Cadastrar e vincular</button>
                </div>
              )}
            </div>

            <div className="border-t border-[#F1F5F9] pt-3">
              <div className="text-[12px] font-medium text-[#5A6B82] mb-2">Pedido</div>
              {cart.length === 0 ? <p className="py-6 text-center text-[12.5px] text-[#8A98AB]">Nenhum item na venda.</p> : (
                <div className="space-y-3">
                  {cart.map((item) => (
                    <div key={`${item.productId}-${item.catalogPrice}`} className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-[#071A34] leading-snug">{item.name}</div>
                          <div className="text-[11px] text-[#8A98AB]">{item.unit} · tabela {formatBRL(item.catalogPrice)}</div>
                        </div>
                        <button type="button" aria-label={`Remover ${item.name}`} onClick={() => setCart((current) => current.filter((entry) => entry !== item))} className="text-[#8A98AB] hover:text-rose-700"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setCart((current) => current.map((entry) => entry === item ? { ...entry, quantity: Math.max(1, entry.quantity - 1) } : entry))} className="h-6 w-6 rounded-md border border-[#E4EAF1] inline-flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                          <span className="w-6 text-center text-[12.5px] tabular-nums">{item.quantity}</span>
                          <button type="button" onClick={() => setCart((current) => current.map((entry) => entry === item ? { ...entry, quantity: entry.quantity + 1 } : entry))} className="h-6 w-6 rounded-md border border-[#E4EAF1] inline-flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                        </div>
                        <input aria-label={`Valor de ${item.name}`} value={String(item.unitPrice)} onChange={(event) => setCart((current) => current.map((entry) => entry === item ? { ...entry, unitPrice: Math.max(0, Number(event.target.value.replace(',', '.')) || 0) } : entry))} className="h-7 w-16 rounded-md border border-[#E4EAF1] px-2 text-right text-[12px] tabular-nums" />
                        <input aria-label={`Desconto de ${item.name}`} value={String(item.discount || '')} placeholder="desc." onChange={(event) => setCart((current) => current.map((entry) => entry === item ? { ...entry, discount: Math.max(0, Number(event.target.value.replace(',', '.')) || 0) } : entry))} className="h-7 w-14 rounded-md border border-[#E4EAF1] px-2 text-right text-[12px]" />
                        <span className="text-[12.5px] font-medium tabular-nums text-[#071A34]">{formatBRL(lineNet(item))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[#F1F5F9] pt-3 space-y-2 text-[12.5px]">
              <div className="flex justify-between text-[#5A6B82]"><span>Subtotal</span><span className="tabular-nums">{formatBRL(quote.subtotal)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#5A6B82]">Desconto geral</span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setDiscountMode('valor')} className={`h-6 px-1.5 rounded ${discountMode === 'valor' ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'}`}>R$</button>
                  <button type="button" onClick={() => setDiscountMode('percent')} className={`h-6 px-1.5 rounded ${discountMode === 'percent' ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'}`}>%</button>
                  <input value={discountRaw} onChange={(event) => setDiscountRaw(event.target.value)} aria-label="Desconto" className="h-7 w-16 rounded-md border border-[#E4EAF1] px-2 text-right text-[12px]" />
                </span>
              </div>
              {quote.discount > 0 && <div className="flex justify-between text-[12px] text-[#5A6B82]"><span>Desconto aplicado</span><span className="tabular-nums">− {formatBRL(quote.discount)}</span></div>}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#5A6B82]">Acréscimo</span>
                <input value={additionRaw} onChange={(event) => setAdditionRaw(event.target.value)} aria-label="Acréscimo" className="h-7 w-16 rounded-md border border-[#E4EAF1] px-2 text-right text-[12px]" />
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-[13px] text-[#334155]">Total</span>
                <span className="text-[20px] font-semibold text-[#071A34] tabular-nums">{formatBRL(quote.total)}</span>
              </div>
            </div>

            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Observações da venda" aria-label="Observações da venda" className="w-full rounded-lg border border-[#E4EAF1] px-3 py-2 text-[12.5px] outline-none resize-none" />

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[12px] text-[#334155]"><input type="checkbox" checked={receiveNow} onChange={(event) => setReceiveNow(event.target.checked)} />Receber agora</label>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENTS.map((method) => <button key={method} type="button" onClick={() => setPayment(method)} className={`h-7 px-2 rounded-full text-[11.5px] ${payment === method ? 'bg-[#071A34] text-white' : 'bg-[#F6F8FB] text-[#334155]'}`}>{method}</button>)}
              </div>
              {receiveNow && <button type="button" onClick={() => setSplit((value) => !value)} className="text-[11.5px] text-[#5A6B82] hover:text-[#071A34]">{split ? 'Pagamento único' : 'Dividir pagamento'}</button>}
              {receiveNow && split && (
                <div className="flex items-center gap-2">
                  <select value={secondPayment} onChange={(event) => setSecondPayment(event.target.value as PayMethod)} aria-label="Segunda forma" className="h-8 flex-1 rounded-lg border border-[#E4EAF1] px-2 text-[12px]">{PAYMENTS.filter((method) => method !== payment).map((method) => <option key={method}>{method}</option>)}</select>
                  <input value={secondAmount} onChange={(event) => setSecondAmount(event.target.value)} aria-label="Valor da segunda forma" placeholder="Valor" className="h-8 w-20 rounded-lg border border-[#E4EAF1] px-2 text-[12px]" />
                </div>
              )}
              {receiveNow && payment === 'Dinheiro' && <label className="flex items-center justify-between gap-2 text-[12px] text-[#5A6B82]">Valor pago<input value={cashPaid} onChange={(event) => setCashPaid(event.target.value)} aria-label="Valor pago" className="h-8 w-24 rounded-lg border border-[#E4EAF1] px-2 text-right text-[12.5px] text-[#071A34]" /></label>}
              <div className="flex justify-between text-[12px] text-[#5A6B82]"><span>Restante</span><span className="tabular-nums">{formatBRL(remaining)}</span></div>
              {change > 0 && <div className="flex justify-between text-[12px] text-[#5A6B82]"><span>Troco</span><span className="tabular-nums">{formatBRL(change)}</span></div>}
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => cart.length > 0 && setConfirmClear(true)} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]">Limpar</button>
              <button type="button" disabled={saving} onClick={() => void finalize()} className="h-9 flex-1 rounded-lg bg-[#071A34] text-white text-[13px] font-medium hover:bg-[#0D284D] disabled:opacity-40 inline-flex items-center justify-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5 text-[#E3C16F]" />{saving ? 'Salvando…' : 'Finalizar venda'}</button>
            </div>
          </aside>
        </div>
      )}

      {confirmClear && <Confirm title="Limpar esta venda?" text="Os itens e ajustes desta venda serão descartados." confirm="Limpar" onClose={() => setConfirmClear(false)} onConfirm={() => { setCart([]); setDiscountRaw(''); setAdditionRaw(''); setNotes(''); setConfirmClear(false); }} />}
      {receipt && <Receipt sale={receipt} onClose={() => setReceipt(null)} />}
      {selectedSale && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button type="button" className="absolute inset-0 bg-[#071A34]/20" aria-label="Fechar venda" onClick={() => setSelectedSale(null)} />
          <aside className="relative h-full w-full max-w-md bg-white border-l border-[#E4EAF1] p-5 overflow-y-auto space-y-3">
            <div className="flex items-start justify-between"><div><h3 className="text-[16px] font-semibold text-[#071A34]">{selectedSale.code}</h3><p className="text-[12px] text-[#5A6B82]">{selectedSale.dateLabel} · {selectedSale.status === 'cancelada' ? 'Cancelada' : 'Finalizada'}</p></div><button type="button" onClick={() => setSelectedSale(null)} aria-label="Fechar"><X className="w-4 h-4 text-[#8A98AB]" /></button></div>
            <p className="text-[13px] text-[#071A34]">{selectedSale.clientName}</p>
            {selectedSale.lines.map((line) => <div key={`${line.productId}-${line.name}`} className="flex justify-between text-[12.5px]"><span>{line.quantity}× {line.name}</span><span className="tabular-nums">{formatBRL(lineNet(line))}</span></div>)}
            <div className="text-[12.5px] text-[#5A6B82] space-y-1"><div className="flex justify-between"><span>Subtotal</span><span>{formatBRL(selectedSale.subtotal)}</span></div><div className="flex justify-between"><span>Desconto</span><span>{formatBRL(selectedSale.discount)}</span></div><div className="flex justify-between"><span>Acréscimo</span><span>{formatBRL(selectedSale.addition)}</span></div><div className="flex justify-between text-[#071A34] font-semibold"><span>Total</span><span>{formatBRL(selectedSale.total)}</span></div><div className="flex justify-between"><span>Recebido</span><span>{formatBRL(selectedSale.received)}</span></div><div className="flex justify-between"><span>Pendente</span><span>{formatBRL(selectedSale.pending)}</span></div></div>
            {selectedSale.notes && <p className="text-[12.5px] text-[#334155]">{selectedSale.notes}</p>}
            {selectedSale.status !== 'cancelada' && (
              <div className="space-y-2 pt-2">
                <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} placeholder="Motivo do cancelamento" className="w-full rounded-lg border border-[#E4EAF1] px-3 py-2 text-[12.5px] resize-none" />
                <button type="button" onClick={() => void cancelSale()} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Cancelar venda</button>
              </div>
            )}
            {selectedSale.cancelReason && <p className="text-[12.5px] text-[#5A6B82]">Motivo: {selectedSale.cancelReason}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

function buildPayments(total: number, receiveNow: boolean, payment: PayMethod, split: boolean, second: PayMethod, secondAmount: number, cashTendered: number) {
  if (!receiveNow || total <= 0) return [];
  const now = new Date().toISOString();
  const payments: StoredSale['payments'] = [];
  const secondPaid = split ? money(Math.min(total, secondAmount)) : 0;
  if (secondPaid > 0) payments.push({ id: `pay-${now}-2`, method: second, amount: secondPaid, paidAt: now });
  const rest = money(total - secondPaid);
  if (rest <= 0) return payments;
  if (payment === 'Dinheiro') {
    const received = money(Math.min(rest, Math.max(0, cashTendered)));
    if (received > 0) payments.push({ id: `pay-${now}-1`, method: 'Dinheiro', amount: received, paidAt: now });
  } else {
    payments.push({ id: `pay-${now}-1`, method: payment, amount: rest, paidAt: now });
  }
  return payments;
}

function nextCode(records: StoredSale[]): string {
  const max = records.reduce((current, sale) => {
    const value = Number(sale.code.replace(/\D/g, ''));
    return Number.isFinite(value) ? Math.max(current, value) : current;
  }, 1084);
  return `VD-${max + 1}`;
}

function Confirm({ title, text, confirm, onClose, onConfirm }: { title: string; text: string; confirm: string; onClose: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-40 flex items-center justify-center p-4"><button type="button" className="absolute inset-0 bg-[#071A34]/20" aria-label="Cancelar" onClick={onClose} /><div className="relative w-full max-w-sm bg-white rounded-xl border border-[#E4EAF1] p-5"><h3 className="text-[15px] font-semibold text-[#071A34]">{title}</h3><p className="mt-1 text-[12.5px] text-[#5A6B82]">{text}</p><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Voltar</button><button type="button" onClick={onConfirm} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">{confirm}</button></div></div></div>;
}

function Receipt({ sale, onClose }: { sale: StoredSale; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-[#071A34]/20" aria-label="Fechar comprovante" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-xl border border-[#E4EAF1] p-5 space-y-3">
        <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-5 h-5" /><h3 className="text-[15px] font-semibold">Comprovante de venda</h3></div>
        <p className="text-[11px] text-[#8A98AB]">BARUCH · Gestão Gráfica. Este comprovante não é nota fiscal.</p>
        <div className="text-[12.5px] text-[#334155] space-y-1">
          <div className="font-medium text-[#071A34]">{sale.code} · {sale.dateLabel}</div>
          <div>{sale.clientName}</div>
          {sale.lines.map((line) => <div key={`${line.productId}-${line.name}`}>{line.quantity}× {line.name} · {formatBRL(line.unitPrice)}</div>)}
          <div>Subtotal {formatBRL(sale.subtotal)} · Desconto {formatBRL(sale.discount)}</div>
          <div>Recebido {formatBRL(sale.received)} · Restante {formatBRL(sale.pending)}</div>
          <div className="text-[18px] font-semibold text-[#071A34] tabular-nums">{formatBRL(sale.total)}</div>
        </div>
        <button type="button" onClick={() => window.print()} className="h-9 w-full rounded-lg border border-[#E4EAF1] text-[12.5px]">Imprimir comprovante</button>
        <button type="button" onClick={onClose} className="h-9 w-full rounded-lg bg-[#071A34] text-white text-[12.5px]">Nova venda</button>
      </div>
    </div>
  );
}
