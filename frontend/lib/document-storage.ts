import type { Professor } from './ponto';

type DocumentCache = Record<string, Professor['sheets']>;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ponto-docente-documents', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function restoreDocuments(professors: Professor[], cache?: DocumentCache, legacy?: Professor[]): Professor[] {
  return professors.map(professor => {
    // IDs demonstrativos podiam coincidir com IDs reais. Migre somente se
    // matrícula e ID corresponderem; o cadastro sempre vem do servidor.
    const stored = cache?.[professor.id] ?? legacy?.find(
      p => p.id === professor.id && p.registration === professor.registration,
    )?.sheets ?? {};
    const sheets = Object.fromEntries(Object.entries(stored).map(([month, sheet]) => {
      const restored = {
        ...sheet,
        // Confirmações anteriores à integração precisam ser salvas no servidor.
        confirmedAt: sheet.backendId ? sheet.confirmedAt : undefined,
      };
      return [month, sheet.status === 'processing'
        ? { ...restored, status: 'error' as const, error: 'Processamento interrompido. Tente novamente.' }
        : restored];
    }));
    return { ...professor, sheets };
  });
}

export async function loadDocuments(professors: Professor[]): Promise<Professor[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state');
    const store = tx.objectStore('state');
    const cache = store.get('documents-v2');
    const legacy = store.get('professors');
    tx.oncomplete = () => {
      db.close();
      resolve(restoreDocuments(professors, cache.result, cache.result ? undefined : legacy.result));
    };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function persistDocuments(professors: Professor[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    // Somente documentos locais; nome, matrícula e contato são do PostgreSQL.
    tx.objectStore('state').put(Object.fromEntries(professors.map(p => [p.id, p.sheets])), 'documents-v2');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
