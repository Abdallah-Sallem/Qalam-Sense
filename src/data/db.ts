/**
 * Thin promise wrapper over IndexedDB. One database, one object store per
 * entity, declared in SCHEMA. No ORM, no hidden caching.
 */
import type {
  Account,
  AuditEntry,
  AuthSession,
  BaselineRecord,
  Consent,
  KeyGrant,
  ParentLink,
  SessionRecord,
  Student,
  TextDoc,
} from '@/domain/types';

export const DB_NAME = 'qalam-sense';
export const DB_VERSION = 1;

export interface Stores {
  accounts: Account;
  students: Student;
  grants: KeyGrant;
  links: ParentLink;
  texts: TextDoc;
  consents: Consent;
  sessions: SessionRecord;
  baselines: BaselineRecord;
  audit: AuditEntry;
  auth: AuthSession & { id: 'current' };
}
export type StoreName = keyof Stores;

const SCHEMA: { [K in StoreName]: { keyPath: string; indexes?: Record<string, { unique?: boolean }> } } = {
  accounts: { keyPath: 'id', indexes: { loginId: { unique: true } } },
  students: { keyPath: 'id', indexes: { teacherId: {} } },
  grants: { keyPath: 'id', indexes: { studentId: {}, holderId: {} } },
  links: { keyPath: 'id', indexes: { parentId: {}, studentId: {} } },
  texts: { keyPath: 'id', indexes: { teacherId: {} } },
  consents: { keyPath: 'studentId' },
  sessions: { keyPath: 'id', indexes: { studentId: {} } },
  baselines: { keyPath: 'id', indexes: { studentId: {} } },
  audit: { keyPath: 'id', indexes: { studentId: {} } },
  auth: { keyPath: 'id' },
};

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

export class Db {
  private constructor(private readonly idb: IDBDatabase) {}

  static async open(name = DB_NAME): Promise<Db> {
    if (typeof indexedDB === 'undefined') throw new Error('storage-unavailable');
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      for (const [store, def] of Object.entries(SCHEMA)) {
        if (idb.objectStoreNames.contains(store)) continue;
        const os = idb.createObjectStore(store, { keyPath: def.keyPath });
        for (const [index, opts] of Object.entries(def.indexes ?? {})) os.createIndex(index, index, { unique: opts.unique ?? false });
      }
    };
    const idb = await request(req);
    // If another tab upgrades or deletes the database, let go instead of blocking it.
    idb.onversionchange = () => idb.close();
    return new Db(idb);
  }

  get<K extends StoreName>(store: K, key: string): Promise<Stores[K] | undefined> {
    return request(this.idb.transaction(store).objectStore(store).get(key));
  }

  all<K extends StoreName>(store: K): Promise<Stores[K][]> {
    return request(this.idb.transaction(store).objectStore(store).getAll());
  }

  by<K extends StoreName>(store: K, index: string, value: string): Promise<Stores[K][]> {
    return request(this.idb.transaction(store).objectStore(store).index(index).getAll(value));
  }

  async put<K extends StoreName>(store: K, value: Stores[K]): Promise<void> {
    const tx = this.idb.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await done(tx);
  }

  async delete(store: StoreName, key: string): Promise<void> {
    const tx = this.idb.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx);
  }

  /**
   * Runs several writes atomically: either all of them are stored or none.
   * `work` must only use the synchronous helpers it is given.
   */
  async batch(
    stores: StoreName[],
    work: (ops: {
      put<K extends StoreName>(store: K, value: Stores[K]): void;
      delete(store: StoreName, key: string): void;
      /** Deletes every record whose index equals value. */
      deleteBy(store: StoreName, index: string, value: string): void;
    }) => void,
  ): Promise<void> {
    const tx = this.idb.transaction(stores, 'readwrite');
    work({
      put: (store, value) => void tx.objectStore(store).put(value),
      delete: (store, key) => void tx.objectStore(store).delete(key),
      deleteBy: (store, index, value) => {
        const cursorReq = tx.objectStore(store).index(index).openCursor(IDBKeyRange.only(value));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
      },
    });
    await done(tx);
  }

  close(): void {
    this.idb.close();
  }
}

/** Irreversibly removes everything Qalam-Sense stored in this browser profile. */
export function wipeDatabase(name = DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('could not delete the database'));
    req.onblocked = () => reject(new Error('database-in-use'));
  });
}
