/**
 * Where exports go. In Chromium the user picks a folder once (File System Access API); the handle is kept in
 * IndexedDB so later exports write straight into it. Other browsers download the files instead.
 */
import { downloadBlob } from '../state/persist';

export interface OutFile {
  name: string;
  blob: Blob;
}

type Permission = 'granted' | 'denied' | 'prompt';

/** Permission methods Chromium adds to handles (not in lib.dom yet). */
interface PermissionedHandle {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<Permission>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<Permission>;
}

type DirectoryPicker = (o?: {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: string | FileSystemHandle;
}) => Promise<FileSystemDirectoryHandle>;

const picker = () =>
  typeof window === 'undefined' ? undefined : (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

/** True where folders can be picked and written (Chromium, secure context). */
export const canPickFolder = () => typeof picker() === 'function';

const DB_NAME = 'midi-viz-export';
const STORE = 'handles';
const KEY = 'folder';

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** The folder picked last time, if any. */
export async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!canPickFolder()) return null;
  try {
    return (await withStore<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Asks for a folder and remembers it. Null when the user cancels. */
export async function pickFolder(current?: FileSystemDirectoryHandle | null) {
  const show = picker();
  if (!show) return null;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await show({ id: 'midi-viz-export', mode: 'readwrite', startIn: current ?? 'music' });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return null;
    throw err;
  }
  try {
    await withStore('readwrite', (s) => s.put(dir, KEY));
  } catch {
    /* remembered for this session only */
  }
  return dir;
}

/** Checks, and if needed asks for, write access. Call from a click so the browser may show its prompt. */
export async function canWrite(dir: FileSystemDirectoryHandle) {
  const d = dir as FileSystemDirectoryHandle & PermissionedHandle;
  if (!d.queryPermission) return true;
  if ((await d.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await d.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

/** Writes the files into the folder, replacing files with the same names. */
export async function writeToFolder(dir: FileSystemDirectoryHandle, files: OutFile[]) {
  let replaced = 0;
  for (const f of files) {
    try {
      await dir.getFileHandle(f.name);
      replaced++;
    } catch {
      /* a new file */
    }
    const handle = await dir.getFileHandle(f.name, { create: true });
    const w = await handle.createWritable();
    try {
      await w.write(f.blob);
      await w.close();
    } catch (err) {
      await w.abort().catch(() => undefined);
      throw err;
    }
  }
  return { written: files.length, replaced };
}

/** Browser downloads, a beat apart so the browser doesn't drop any. */
export async function downloadFiles(files: OutFile[]) {
  for (let i = 0; i < files.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, 250));
    downloadBlob(files[i].blob, files[i].name);
  }
}
