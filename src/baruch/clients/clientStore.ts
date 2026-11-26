import { CLIENTS } from '../data/mockData';
import type { ClientActivity, ClientProfile } from './clientTypes';
import { displayName, initialsOf } from './clientValidation';

const DB_NAME = 'baruch-clients';
const CLIENTS_STORE = 'clients';
const ACTIVITY_STORE = 'activity';
const READY_KEY = 'baruch-clients-ready';

const listeners = new Set<() => void>();

let database: Promise<IDBDatabase> | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeClients(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIENTS_STORE)) {
        db.createObjectStore(CLIENTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ACTIVITY_STORE)) {
        db.createObjectStore(ACTIVITY_STORE, { keyPath: 'clientId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error('Não foi possível abrir os clientes.'));
    };
  });
  return database;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao acessar os clientes.'));
  });
}

const SEED_DATES = ['2026-11-20', '2026-11-18', '2026-10-02', '2026-09-01', '2026-06-15'];

function seedClients(): ClientProfile[] {
  return CLIENTS.map((client, index) => ({
    id: client.id,
    kind: 'pj',
    name: client.name,
    company: client.company,
    document: client.document,
    phone: client.phone,
    whatsapp: '',
    email: client.email,
    address: '',
    city: client.city,
    avatar: null,
    initials: client.initials,
    accentColor: client.accentColor,
    notes: '',
    extra: '',
    status: 'ativo',
    createdAt: SEED_DATES[index] ?? '2026-01-10',
    updatedAt: SEED_DATES[index] ?? '2026-01-10',
  }));
}

export async function loadClients(): Promise<ClientProfile[]> {
  const db = await openDatabase();
  const items = await requestToPromise(
    db.transaction(CLIENTS_STORE, 'readonly').objectStore(CLIENTS_STORE).getAll()
  );
  const stored = items as ClientProfile[];
  if (stored.length > 0) {
    localStorage.setItem(READY_KEY, '1');
    return stored;
  }
  if (localStorage.getItem(READY_KEY) === '1') return [];
  const seed = seedClients();
  await replaceClients(seed);
  localStorage.setItem(READY_KEY, '1');
  return seed;
}

export async function saveClient(client: ClientProfile): Promise<void> {
  const label = displayName(client);
  const next: ClientProfile = {
    ...client,
    name: client.name.trim(),
    company: client.kind === 'pf' ? client.name.trim() || client.company.trim() : client.company.trim(),
    initials: initialsOf(client.kind === 'pf' ? client.name : label),
    updatedAt: new Date().toISOString(),
  };
  const db = await openDatabase();
  await requestToPromise(db.transaction(CLIENTS_STORE, 'readwrite').objectStore(CLIENTS_STORE).put(next));
  localStorage.setItem(READY_KEY, '1');
  notify();
}

export async function deleteClient(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction([CLIENTS_STORE, ACTIVITY_STORE], 'readwrite');
  tx.objectStore(CLIENTS_STORE).delete(id);
  tx.objectStore(ACTIVITY_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Não foi possível excluir o cliente.'));
  });
  notify();
}

export async function loadActivities(): Promise<ClientActivity[]> {
  const db = await openDatabase();
  const items = await requestToPromise(
    db.transaction(ACTIVITY_STORE, 'readonly').objectStore(ACTIVITY_STORE).getAll()
  );
  return items as ClientActivity[];
}

export async function saveClientActivity(activity: ClientActivity): Promise<void> {
  const db = await openDatabase();
  await requestToPromise(db.transaction(ACTIVITY_STORE, 'readwrite').objectStore(ACTIVITY_STORE).put(activity));
  notify();
}

export function clientErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Não há espaço suficiente para salvar a imagem deste cliente.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível concluir a operação.';
}

async function replaceClients(clients: ClientProfile[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CLIENTS_STORE, 'readwrite');
    const store = tx.objectStore(CLIENTS_STORE);
    clients.forEach((client) => store.put(client));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Falha ao gravar os clientes.'));
  });
}

export function blankClient(): ClientProfile {
  const now = new Date().toISOString();
  return {
    id: `cli-${Date.now().toString(36)}`,
    kind: 'pj',
    name: '',
    company: '',
    document: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    city: '',
    avatar: null,
    initials: 'CL',
    accentColor: '#1E3A5F',
    notes: '',
    extra: '',
    status: 'ativo',
    createdAt: now,
    updatedAt: now,
  };
}
