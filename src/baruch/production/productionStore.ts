import { INITIAL_ORDERS } from '../data/mockData';
import { loadSales, updateStoredSale } from '../sales/salesStore';
import type { ProductionOrder } from '../types';

const DB_NAME = 'baruch-production';
const STORE = 'orders';
const READY_KEY = 'baruch-production-ready';
const listeners = new Set<() => void>();
let database: Promise<IDBDatabase> | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeProduction(listener: () => void): () => void {
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
      reject(request.error ?? new Error('Não foi possível abrir a produção.'));
    };
  });
  return database;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao acessar a produção.'));
  });
}

export async function loadProduction(): Promise<ProductionOrder[]> {
  const db = await openDatabase();
  const items = (await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as ProductionOrder[];
  if (items.length > 0 || localStorage.getItem(READY_KEY) === '1') {
    localStorage.setItem(READY_KEY, '1');
    return items;
  }
  await replaceOrders(INITIAL_ORDERS);
  localStorage.setItem(READY_KEY, '1');
  return INITIAL_ORDERS;
}

export async function saveProductionOrder(order: ProductionOrder): Promise<void> {
  const db = await openDatabase();
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(order));
  localStorage.setItem(READY_KEY, '1');
  if (order.saleId) {
    const sales = await loadSales();
    const sale = sales.find((item) => item.id === order.saleId);
    if (sale) {
      await updateStoredSale({
        ...sale,
        productionOrders: sale.productionOrders.map((item) => (item.id === order.id ? order : item)),
      });
    }
  }
  notify();
}

/** Insere pedidos novos vindos da venda. Não sobrescreve um pedido que já existe. */
export async function ensureProductionOrders(orders: ProductionOrder[]): Promise<ProductionOrder[]> {
  const current = await loadProduction();
  const ids = new Set(current.map((order) => order.id));
  const fresh = orders.filter((order) => !ids.has(order.id));
  if (fresh.length === 0) return current;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    fresh.forEach((order) => tx.objectStore(STORE).put(order));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Falha ao incluir a produção.'));
  });
  localStorage.setItem(READY_KEY, '1');
  notify();
  return [...current, ...fresh];
}

async function replaceOrders(orders: ProductionOrder[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    orders.forEach((order) => tx.objectStore(STORE).put(order));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Falha ao gravar a produção.'));
  });
}
