import type { CatalogProduct } from './catalogTypes';
import { buildSeedCatalog } from './seedCatalog';

const DB_NAME = 'baruch-catalog';
const STORE = 'products';
const READY_KEY = 'baruch-catalog-ready';

let database: Promise<IDBDatabase> | null = null;

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
      reject(request.error ?? new Error('Não foi possível abrir o catálogo.'));
    };
  });
  return database;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao acessar o catálogo.'));
  });
}

export async function loadCatalog(): Promise<CatalogProduct[]> {
  const db = await openDatabase();
  const items = await requestToPromise(
    db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
  );
  const stored = (items as CatalogProduct[]).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (stored.length > 0) {
    localStorage.setItem(READY_KEY, '1');
    return stored;
  }
  if (localStorage.getItem(READY_KEY) === '1') return [];
  const seed = buildSeedCatalog().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  await replaceCatalog(seed);
  localStorage.setItem(READY_KEY, '1');
  return seed;
}

export async function saveCatalogProduct(product: CatalogProduct): Promise<void> {
  const db = await openDatabase();
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(product));
  localStorage.setItem(READY_KEY, '1');
}

export async function deleteCatalogProduct(id: string): Promise<void> {
  const db = await openDatabase();
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  localStorage.setItem(READY_KEY, '1');
}

async function replaceCatalog(products: CatalogProduct[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    products.forEach((product) => store.put(product));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Falha ao gravar o catálogo.'));
    tx.onabort = () => reject(tx.error ?? new Error('Gravação do catálogo cancelada.'));
  });
}

export function catalogErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Não há espaço suficiente para salvar as imagens deste produto.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível concluir a operação. Tente novamente.';
}
