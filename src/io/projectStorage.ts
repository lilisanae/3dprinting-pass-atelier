let database: Promise<IDBDatabase> | undefined;
const unavailable = () => new Error('浏览器本地存储暂时不可用，请下载项目备份。');

function openDatabase(): Promise<IDBDatabase> {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(unavailable());
    const request = indexedDB.open('pass-atelier-designs', 1);
    let expired = false;
    const fail = () => {
      expired = true;
      clearTimeout(timer);
      reject(unavailable());
    };
    const timer = setTimeout(fail, 1200);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) return request.result.close();
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = request.onblocked = fail;
  }).catch((error) => {
    database = undefined;
    throw error;
  }));
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode);
    let result: T;
    const timer = setTimeout(() => {
      try {
        tx.abort();
      } catch {
        // Completion may already be queued when the deadline expires.
      }
      reject(unavailable());
    }, 1200);
    const fail = () => {
      clearTimeout(timer);
      reject(unavailable());
    };
    tx.oncomplete = () => {
      clearTimeout(timer);
      resolve(result);
    };
    tx.onerror = tx.onabort = fail;
    try {
      const request = operation(tx.objectStore('projects'));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = fail;
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export const readProjectRecord = <T>(key: string): Promise<T | undefined> =>
  transaction('readonly', (store) => store.get(key));
export async function writeProjectRecord(key: string, value: unknown): Promise<void> {
  await transaction('readwrite', (store) => store.put(value, key));
}
export async function deleteProjectRecord(key: string): Promise<void> {
  await transaction('readwrite', (store) => store.delete(key));
}
