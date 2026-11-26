import { INITIAL_SALES } from '../data/mockData';
import type { ProductionOrder, SaleRecord } from '../types';
import type { StoredSale } from './saleTypes';

const DB_NAME = 'baruch-sales';
const STORE = 'sales';
const READY_KEY = 'baruch-sales-ready';
const listeners = new Set<() => void>();
let database: Promise<IDBDatabase> | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeSales(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error('Não foi possível abrir as vendas.'));
    };
  });
  return database;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao acessar as vendas.'));
  });
}

function seedSales(): StoredSale[] {
  return INITIAL_SALES.map((sale) => ({
    id: sale.id,
    code: sale.code,
    createdAt: '2026-11-26T10:00:00.000Z',
    dateLabel: sale.date,
    clientId: sale.clientId,
    clientName: sale.clientName,
    lines: [
      {
        productId: `legacy-${sale.id}`,
        name: sale.itemsSummary,
        category: 'Registro anterior',
        unit: 'un.',
        quantity: 1,
        unitPrice: sale.total,
        catalogPrice: sale.total,
        discount: 0,
      },
    ],
    notes: '',
    subtotal: sale.total,
    discount: 0,
    addition: 0,
    total: sale.total,
    payments: sale.status === 'confirmada'
      ? [{ id: `pay-${sale.id}`, method: sale.paymentMethod, amount: sale.total, paidAt: '2026-11-26T10:00:00.000Z' }]
      : [],
    received: sale.status === 'confirmada' ? sale.total : 0,
    pending: sale.status === 'confirmada' ? 0 : sale.total,
    paymentStatus: sale.status === 'confirmada' ? 'pago' : 'pendente',
    status: 'finalizada',
    productionOrders: [],
  }));
}

export async function loadSales(): Promise<StoredSale[]> {
  const db = await openDatabase();
  const items = (await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as StoredSale[];
  if (items.length > 0) {
    localStorage.setItem(READY_KEY, '1');
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (localStorage.getItem(READY_KEY) === '1') return [];
  const seed = seedSales();
  await replaceSales(seed);
  localStorage.setItem(READY_KEY, '1');
  return seed;
}

export async function saveStoredSale(sale: StoredSale): Promise<void> {
  const db = await openDatabase();
  const existing = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(sale.id));
  if (existing) return;
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(sale));
  localStorage.setItem(READY_KEY, '1');
  notify();
}

export async function updateStoredSale(sale: StoredSale): Promise<void> {
  const db = await openDatabase();
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(sale));
  notify();
}

export function toSaleRecord(sale: StoredSale): SaleRecord {
  return {
    id: sale.id,
    code: sale.code,
    date: sale.dateLabel,
    clientId: sale.clientId ?? 'avulso',
    clientName: sale.clientName,
    itemsSummary: sale.lines.map((line) => `${line.quantity}× ${line.name}`).join(', '),
    total: sale.total,
    paymentMethod: sale.payments[0]?.method ?? 'PIX',
    status: sale.status === 'cancelada' ? 'cancelada' : sale.pending > 0 ? 'pendente' : 'confirmada',
  };
}

export function productionOrdersFromSales(sales: StoredSale[]): ProductionOrder[] {
  return sales
    .filter((sale) => sale.status !== 'cancelada')
    .flatMap((sale) => sale.productionOrders);
}

async function replaceSales(sales: StoredSale[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    sales.forEach((sale) => tx.objectStore(STORE).put(sale));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Falha ao gravar as vendas.'));
  });
}
