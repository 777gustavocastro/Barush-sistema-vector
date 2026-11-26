import { CheckCircle2, Minus, Plus, Search, ShoppingBag, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CLIENTS, PRODUCTS, formatBRL } from '../data/mockData';
import type { ClientRecord, SaleRecord } from '../types';

interface SalesPageProps {
  sales: SaleRecord[];
  onRegisterSale: (sale: SaleRecord) => void;
  clients?: ClientRecord[];
}

interface CartItem {
  productId: string;
  name: string;
  category: string;
  unitPrice: number;
  quantity: number;
}

type PayMethod = SaleRecord['paymentMethod'];
type Screen = 'pos' | 'history';

const PAYMENTS: PayMethod[] = ['Dinheiro', 'PIX', 'Cartão de débito', 'Cartão de crédito', 'Transferência', 'Boleto'];

export function SalesPage({ sales, onRegisterSale, clients }: SalesPageProps) {
  const directory = clients && clients.length > 0 ? clients : CLIENTS;
  const [screen, setScreen] = useState<Screen>('pos');
  const [productQuery, setProductQuery] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clientId, setClientId] = useState<string | null>(directory[0]?.id ?? null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountMode, setDiscountMode] = useState<'valor' | 'percent'>('valor');
  const [discountRaw, setDiscountRaw] = useState('');
  const [additionRaw, setAdditionRaw] = useState('');
  const [payment, setPayment] = useState<PayMethod>('PIX');
  const [split, setSplit] = useState(false);
  const [secondPayment, setSecondPayment] = useState<PayMethod>('Dinheiro');
  const [secondAmount, setSecondAmount] = useState('');
  const [cashPaid, setCashPaid] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [receipt, setReceipt] = useState<SaleRecord | null>(null);

  useEffect(() => {
    if (clientId && !directory.some((client) => client.id === clientId)) setClientId(directory[0]?.id ?? null);
  }, [directory, clientId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const foundProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return PRODUCTS.filter((product) => !q || product.name.toLowerCase().includes(q) || product.category.toLowerCase().includes(q));
  }, [productQuery]);

  const foundClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    return directory.filter((client) => !q || `${client.company} ${client.name} ${client.phone}`.toLowerCase().includes(q)).slice(0, 5);
  }, [clientQuery, directory]);

  const selectedClient = directory.find((client) => client.id === clientId) ?? null;
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discountValue = Math.min(subtotal, discountMode === 'percent' ? subtotal * (Number(discountRaw.replace(',', '.')) || 0) / 100 : Number(discountRaw.replace(',', '.')) || 0);
  const additionValue = Math.max(0, Number(additionRaw.replace(',', '.')) || 0);
  const total = Math.max(0, subtotal - discountValue + additionValue);
  const paidSecond = split ? Math.min(total, Number(secondAmount.replace(',', '.')) || 0) : 0;
  const paidCash = payment === 'Dinheiro' ? Number(cashPaid.replace(',', '.')) || 0 : total - paidSecond;
  const remaining = Math.max(0, total - paidSecond - (payment === 'Dinheiro' ? paidCash : total - paidSecond));
  const change = payment === 'Dinheiro' ? Math.max(0, paidCash - (total - paidSecond)) : 0;

  const addProduct = (productId: string) => {
    const product = PRODUCTS.find((item) => item.id === productId);
    if (!product) return;
    setCart((current) => {
      const existing = current.find((item) => item.productId === productId);
      if (existing) return current.map((item) => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { productId: product.id, name: product.name, category: product.category, unitPrice: product.price, quantity: 1 }];
    });
    setScreen('pos');
  };

  const finalize = () => {
    if (cart.length === 0) {
      setNotice({ tone: 'err', text: 'Adicione ao menos um item para finalizar a venda.' });
      return;
    }
    const sale: SaleRecord = {
      id: `sal-${Date.now()}`,
      code: `VD-${1085 + sales.length}`,
      date: 'Agora',
      clientId: selectedClient?.id ?? 'avulso',
      clientName: selectedClient ? selectedClient.company : 'Sem cliente',
      itemsSummary: cart.map((item) => `${item.quantity}× ${item.name}`).join(', '),
      total,
      paymentMethod: payment,
      status: remaining > 0 ? 'pendente' : 'confirmada',
    };
    onRegisterSale(sale);
    setReceipt(sale);
    setCart([]);
    setDiscountRaw('');
    setAdditionRaw('');
    setCashPaid('');
    setSplit(false);
  };

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

      {screen === 'history' ? (
        <SalesHistory sales={sales} onBack={() => setScreen('pos')} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
          <section className="min-w-0 space-y-3">
            <label className="relative block">
              <Search className="w-3.5 h-3.5 text-[#8A98AB] absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Buscar produto por nome ou categoria" aria-label="Buscar produto" className="h-9 w-full rounded-lg border border-[#E4EAF1] bg-white pl-8 pr-3 text-[12.5px] outline-none focus:border-[#C5D0DE]" />
            </label>
            {foundProducts.length === 0 ? (
              <p className="py-10 text-center text-[12.5px] text-[#8A98AB]">Nenhum produto encontrado.</p>
            ) : (
              <div className="divide-y divide-[#F1F5F9]">
                {foundProducts.map((product) => (
                  <div key={product.id} className="py-2.5 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-[#F4F7FB] text-[10px] font-semibold text-[#071A34] inline-flex items-center justify-center shrink-0">{product.category.slice(0, 2).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#071A34] truncate">{product.name}</div>
                      <div className="text-[11.5px] text-[#5A6B82]">{product.category} · un.</div>
                    </div>
                    <div className="text-[13px] font-semibold text-[#071A34] tabular-nums shrink-0">{formatBRL(product.price)}</div>
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
              <div className="mt-2 flex items-center gap-2 text-[12.5px]">
                <UserRound className="w-3.5 h-3.5 text-[#8A98AB]" />
                <span className="text-[#071A34] truncate">{selectedClient ? selectedClient.company : 'Venda sem cliente'}</span>
              </div>
            </div>

            <div className="border-t border-[#F1F5F9] pt-3">
              <div className="text-[12px] font-medium text-[#5A6B82] mb-2">Pedido</div>
              {cart.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-[#8A98AB]">Nenhum item na venda.</p>
              ) : (
                <div className="space-y-3">
                  {cart.map((item) => (
                    <div key={item.productId} className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-[#071A34] leading-snug">{item.name}</div>
                          <div className="text-[11px] text-[#8A98AB]">{item.category}</div>
                        </div>
                        <button type="button" aria-label={`Remover ${item.name}`} onClick={() => setCart((current) => current.filter((entry) => entry.productId !== item.productId))} className="text-[#8A98AB] hover:text-rose-700"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setCart((current) => current.map((entry) => entry.productId === item.productId ? { ...entry, quantity: Math.max(1, entry.quantity - 1) } : entry))} className="h-6 w-6 rounded-md border border-[#E4EAF1] inline-flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                          <span className="w-6 text-center text-[12.5px] tabular-nums">{item.quantity}</span>
                          <button type="button" onClick={() => setCart((current) => current.map((entry) => entry.productId === item.productId ? { ...entry, quantity: entry.quantity + 1 } : entry))} className="h-6 w-6 rounded-md border border-[#E4EAF1] inline-flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                        </div>
                        <input aria-label={`Valor de ${item.name}`} value={String(item.unitPrice)} onChange={(event) => setCart((current) => current.map((entry) => entry.productId === item.productId ? { ...entry, unitPrice: Number(event.target.value.replace(',', '.')) || 0 } : entry))} className="h-7 w-20 rounded-md border border-[#E4EAF1] px-2 text-right text-[12px] tabular-nums" />
                        <span className="text-[12.5px] font-medium tabular-nums text-[#071A34]">{formatBRL(item.unitPrice * item.quantity)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[#F1F5F9] pt-3 space-y-2 text-[12.5px]">
              <div className="flex justify-between text-[#5A6B82]"><span>Subtotal</span><span className="tabular-nums">{formatBRL(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#5A6B82]">Desconto</span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setDiscountMode('valor')} className={`h-6 px-1.5 rounded ${discountMode === 'valor' ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'}`}>R$</button>
                  <button type="button" onClick={() => setDiscountMode('percent')} className={`h-6 px-1.5 rounded ${discountMode === 'percent' ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'}`}>%</button>
                  <input value={discountRaw} onChange={(event) => setDiscountRaw(event.target.value)} aria-label="Desconto" className="h-7 w-16 rounded-md border border-[#E4EAF1] px-2 text-right text-[12px]" />
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#5A6B82]">Acréscimo</span>
                <input value={additionRaw} onChange={(event) => setAdditionRaw(event.target.value)} aria-label="Acréscimo" className="h-7 w-16 rounded-md border border-[#E4EAF1] px-2 text-right text-[12px]" />
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-[13px] text-[#334155]">Total</span>
                <span className="text-[20px] font-semibold text-[#071A34] tabular-nums">{formatBRL(total)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PAYMENTS.map((method) => (
                  <button key={method} type="button" onClick={() => setPayment(method)} className={`h-7 px-2 rounded-full text-[11.5px] ${payment === method ? 'bg-[#071A34] text-white' : 'bg-[#F6F8FB] text-[#334155]'}`}>{method}</button>
                ))}
              </div>
              <button type="button" onClick={() => setSplit((value) => !value)} className="text-[11.5px] text-[#5A6B82] hover:text-[#071A34]">{split ? 'Pagamento único' : 'Dividir pagamento'}</button>
              {split && (
                <div className="flex items-center gap-2">
                  <select value={secondPayment} onChange={(event) => setSecondPayment(event.target.value as PayMethod)} aria-label="Segunda forma" className="h-8 flex-1 rounded-lg border border-[#E4EAF1] px-2 text-[12px]">
                    {PAYMENTS.filter((method) => method !== payment).map((method) => <option key={method}>{method}</option>)}
                  </select>
                  <input value={secondAmount} onChange={(event) => setSecondAmount(event.target.value)} aria-label="Valor da segunda forma" placeholder="Valor" className="h-8 w-20 rounded-lg border border-[#E4EAF1] px-2 text-[12px]" />
                </div>
              )}
              {payment === 'Dinheiro' && (
                <label className="flex items-center justify-between gap-2 text-[12px] text-[#5A6B82]">
                  Valor pago
                  <input value={cashPaid} onChange={(event) => setCashPaid(event.target.value)} aria-label="Valor pago" className="h-8 w-24 rounded-lg border border-[#E4EAF1] px-2 text-right text-[12.5px] text-[#071A34]" />
                </label>
              )}
              <div className="flex justify-between text-[12px] text-[#5A6B82]"><span>Restante</span><span className="tabular-nums">{formatBRL(remaining)}</span></div>
              {change > 0 && <div className="flex justify-between text-[12px] text-[#5A6B82]"><span>Troco</span><span className="tabular-nums">{formatBRL(change)}</span></div>}
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => cart.length > 0 && setConfirmClear(true)} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]">Limpar</button>
              <button type="button" onClick={finalize} className="h-9 flex-1 rounded-lg bg-[#071A34] text-white text-[13px] font-medium hover:bg-[#0D284D] inline-flex items-center justify-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5 text-[#E3C16F]" />Finalizar venda</button>
            </div>
          </aside>
        </div>
      )}

      {confirmClear && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-[#071A34]/20" aria-label="Cancelar" onClick={() => setConfirmClear(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-xl border border-[#E4EAF1] p-5">
            <h3 className="text-[15px] font-semibold text-[#071A34]">Limpar esta venda?</h3>
            <p className="mt-1 text-[12.5px] text-[#5A6B82]">Os itens e ajustes desta venda serão descartados.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmClear(false)} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Voltar</button>
              <button type="button" onClick={() => { setCart([]); setDiscountRaw(''); setAdditionRaw(''); setConfirmClear(false); }} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">Limpar</button>
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-[#071A34]/20" aria-label="Fechar comprovante" onClick={() => setReceipt(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-xl border border-[#E4EAF1] p-5 space-y-3">
            <button type="button" onClick={() => setReceipt(null)} aria-label="Fechar" className="absolute top-3 right-3 text-[#8A98AB]"><X className="w-4 h-4" /></button>
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-5 h-5" /><h3 className="text-[15px] font-semibold">Venda concluída</h3></div>
            <div className="text-[12.5px] text-[#334155] space-y-1">
              <div className="font-medium text-[#071A34]">{receipt.code}</div>
              <div>{receipt.clientName}</div>
              <div>{receipt.itemsSummary}</div>
              <div>{receipt.paymentMethod} · {receipt.status === 'confirmada' ? 'Pago' : 'Pendente'}</div>
              <div className="text-[18px] font-semibold text-[#071A34] tabular-nums">{formatBRL(receipt.total)}</div>
            </div>
            <button type="button" onClick={() => setReceipt(null)} className="h-9 w-full rounded-lg bg-[#071A34] text-white text-[12.5px]">Nova venda</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SalesHistory({ sales, onBack }: { sales: SaleRecord[]; onBack: () => void }) {
  return (
    <section className="space-y-3">
      <button type="button" onClick={onBack} className="text-[12.5px] text-[#5A6B82] hover:text-[#071A34]">Voltar à nova venda</button>
      {sales.length === 0 ? (
        <p className="py-12 text-center text-[12.5px] text-[#8A98AB]">Nenhuma venda registrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF2F7] text-[11.5px] font-medium text-[#5A6B82]">
                <th className="py-2.5 pr-3 font-medium">Venda</th>
                <th className="py-2.5 pr-3 font-medium">Cliente</th>
                <th className="py-2.5 pr-3 font-medium">Data</th>
                <th className="py-2.5 pr-3 font-medium">Itens</th>
                <th className="py-2.5 pr-3 font-medium">Pagamento</th>
                <th className="py-2.5 pr-3 font-medium">Status</th>
                <th className="py-2.5 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="py-2.5 pr-3 font-medium text-[#071A34]">{sale.code}</td>
                  <td className="py-2.5 pr-3">{sale.clientName}</td>
                  <td className="py-2.5 pr-3 text-[#5A6B82] whitespace-nowrap">{sale.date}</td>
                  <td className="py-2.5 pr-3 text-[#5A6B82] max-w-[240px] truncate">{sale.itemsSummary}</td>
                  <td className="py-2.5 pr-3">{sale.paymentMethod}</td>
                  <td className="py-2.5 pr-3">{sale.status === 'confirmada' ? 'Paga' : 'Pendente'}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{formatBRL(sale.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
