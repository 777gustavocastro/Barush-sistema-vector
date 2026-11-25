import { CheckCircle2, Minus, Plus, Printer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CLIENTS, PRODUCTS, formatBRL } from '../data/mockData';
import type { SaleRecord } from '../types';

interface SalesPageProps {
  sales: SaleRecord[];
  onRegisterSale: (sale: SaleRecord) => void;
}

interface CartItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

const PAYMENT_METHODS: SaleRecord['paymentMethod'][] = [
  'PIX',
  'Cartão',
  'Boleto',
  'Transferência',
];

export function SalesPage({ sales, onRegisterSale }: SalesPageProps) {
  const [clientId, setClientId] = useState(CLIENTS[0].id);
  const [paymentMethod, setPaymentMethod] = useState<SaleRecord['paymentMethod']>('PIX');
  const [cart, setCart] = useState<CartItem[]>([
    {
      productId: PRODUCTS[0].id,
      name: PRODUCTS[0].name,
      unitPrice: PRODUCTS[0].price,
      quantity: 2,
    },
  ]);
  const [lastReceipt, setLastReceipt] = useState<SaleRecord | null>(null);

  const selectedClient = CLIENTS.find((c) => c.id === clientId) ?? CLIENTS[0];
  const total = cart.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);

  const addProduct = (productId: string) => {
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === productId);
      if (existing) {
        return prev.map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          unitPrice: product.price,
          quantity: 1,
        },
      ];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleFinalize = () => {
    if (cart.length === 0) return;
    const summary = cart.map((i) => `${i.quantity}× ${i.name}`).join(', ');
    const newSale: SaleRecord = {
      id: `sal-${Date.now()}`,
      code: `VD-${1085 + sales.length}`,
      date: 'Agora',
      clientId: selectedClient.id,
      clientName: selectedClient.company,
      itemsSummary: summary,
      total,
      paymentMethod,
      status: 'confirmada',
    };
    onRegisterSale(newSale);
    setLastReceipt(newSale);
    setCart([]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
          Ponto de Venda (PDV)
        </h2>
        <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
          Seleção de cliente, composição de itens, forma de pagamento e emissão de comprovante.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Catálogo rápido para adicionar ao pedido */}
        <section className="xl:col-span-7 bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EEF2F7] flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold text-[#071A34]">
              Selecionar produtos
            </h3>
            <span className="text-[12px] text-[#5A6B82]">
              Clique para adicionar à venda
            </span>
          </div>
          <div className="divide-y divide-[#F1F5F9]">
            {PRODUCTS.map((product) => (
              <div
                key={product.id}
                className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#0F1E36] truncate">
                    {product.name}
                  </div>
                  <div className="text-[11.5px] text-[#5A6B82]">
                    {product.sku} · {product.dimensions}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[13px] font-semibold text-[#071A34] tabular-nums">
                    {formatBRL(product.price)}
                  </span>
                  <button
                    type="button"
                    onClick={() => addProduct(product.id)}
                    className="h-7 px-2.5 rounded-md border border-[#DCE3EC] bg-white text-[#071A34] text-[12px] font-medium hover:bg-[#071A34] hover:text-white hover:border-[#071A34] transition-colors inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Incluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Resumo do pedido + Pagamento + Comprovante */}
        <aside className="xl:col-span-5 bg-white border border-[#E4EAF1] rounded-lg p-5 space-y-4 self-start">
          <div>
            <label className="block text-[12px] font-medium text-[#5A6B82] mb-1.5">
              Cliente
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full h-9 px-3 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[13px] text-[#0F1E36] focus:outline-none focus:bg-white focus:border-[#071A34]/40"
            >
              {CLIENTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company} — {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Itens no carrinho */}
          <div className="border-t border-[#EEF2F7] pt-3">
            <div className="text-[12px] font-medium text-[#5A6B82] mb-2">
              Itens da venda ({cart.length})
            </div>
            {cart.length === 0 ? (
              <p className="text-[12.5px] text-slate-400 py-4 text-center bg-[#FAFBFD] rounded-md border border-dashed border-[#E4EAF1]">
                Adicione produtos ao lado para iniciar a venda.
              </p>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center justify-between gap-2 text-[12.5px] py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#0F1E36] truncate">
                        {item.name}
                      </div>
                      <div className="text-[11.5px] text-[#5A6B82] tabular-nums">
                        {formatBRL(item.unitPrice)} un.
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, -1)}
                        className="w-6 h-6 rounded border border-[#E4EAF1] flex items-center justify-center text-[#5A6B82] hover:text-[#071A34]"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center font-medium tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, 1)}
                        className="w-6 h-6 rounded border border-[#E4EAF1] flex items-center justify-center text-[#5A6B82] hover:text-[#071A34]"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, -item.quantity)}
                        className="w-6 h-6 rounded text-slate-400 hover:text-rose-600 flex items-center justify-center ml-0.5"
                        aria-label="Remover item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Forma de pagamento */}
          <div className="border-t border-[#EEF2F7] pt-3">
            <div className="text-[12px] font-medium text-[#5A6B82] mb-2">
              Forma de pagamento
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`h-8 rounded-md text-[12.5px] font-medium transition-colors ${
                    paymentMethod === method
                      ? 'bg-[#071A34] text-white'
                      : 'bg-[#F6F8FB] border border-[#E4EAF1] text-[#334155] hover:border-[#CBD5E1]'
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          {/* Total e confirmação */}
          <div className="border-t border-[#EEF2F7] pt-3 flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-[#5A6B82]">Total a receber</span>
            <span className="text-[20px] font-semibold text-[#071A34] tabular-nums">
              {formatBRL(total)}
            </span>
          </div>

          <button
            type="button"
            disabled={cart.length === 0}
            onClick={handleFinalize}
            className="w-full h-9 rounded-md bg-[#071A34] text-white text-[13px] font-medium hover:bg-[#0D284D] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Registrar venda e gerar comprovante
          </button>

          {lastReceipt && (
            <div className="p-3 rounded-md bg-emerald-50/70 border border-emerald-200/80 text-[12px] space-y-1">
              <div className="flex items-center justify-between text-emerald-800 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Comprovante {lastReceipt.code} emitido
                </span>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 text-[#071A34] hover:underline"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Imprimir
                </button>
              </div>
              <div className="text-emerald-900/80">
                {lastReceipt.clientName} · {lastReceipt.paymentMethod} ·{' '}
                <strong className="tabular-nums">{formatBRL(lastReceipt.total)}</strong>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Histórico de vendas */}
      <section className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EEF2F7]">
          <h3 className="text-[13.5px] font-semibold text-[#071A34]">
            Registro de vendas
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
                <th className="py-2.5 px-4">Código</th>
                <th className="py-2.5 px-4">Cliente</th>
                <th className="py-2.5 px-4">Itens</th>
                <th className="py-2.5 px-4">Pagamento</th>
                <th className="py-2.5 px-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
              {sales.map((sale) => (
                <tr key={sale.id} className="hover:bg-[#F8FAFC]">
                  <td className="py-2.5 px-4 font-mono text-[12px] font-medium text-[#071A34]">
                    {sale.code}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-[#0F1E36]">
                    {sale.clientName}
                  </td>
                  <td className="py-2.5 px-4 text-[#5A6B82] max-w-md truncate">
                    {sale.itemsSummary}
                  </td>
                  <td className="py-2.5 px-4 text-[#334155]">{sale.paymentMethod}</td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-[#071A34]">
                    {formatBRL(sale.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
