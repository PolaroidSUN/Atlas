import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

type AtlasItem = { id: string; type: string; [key: string]: unknown }
type AtlasChanges = { upserts: AtlasItem[]; deletedIds: string[] }
type AtlasBridge = {
  platform: string
  version: string
  workspace: {
    load: () => Promise<{ formatVersion: number; items: AtlasItem[] }>
    save: (changes: AtlasChanges) => Promise<unknown>
    closeReady: (saved: boolean) => void
  }
  onFlushRequest: (callback: () => void) => () => void
  onFlushFailure: (callback: () => void) => () => void
  onMenuAction: (callback: (action: string) => void) => () => void
}

declare global {
  interface Window { atlas: AtlasBridge }
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const currentWindow = isTauri ? getCurrentWindow() : null
const BROWSER_STORAGE_KEY = 'atlas-vite-workspace-v1'
const LEGACY_BROWSER_STORAGE_KEYS = ['atlas-alpha-workspace-v1']
const BROWSER_DB_NAME = 'atlas-local-workspace'
const BROWSER_DB_VERSION = 1
const BROWSER_DB_STORE = 'items'
const BROWSER_MIGRATION_KEY = 'atlas-indexeddb-migrated-v1'
let flushRequested = false
let allowNextClose = false
let closeListenerInstalled = false
let flushCallback: (() => void) | undefined
const failureListeners = new Set<() => void>()

function parseLegacyLocalItems(): AtlasItem[] {
  for (const key of [BROWSER_STORAGE_KEY, ...LEGACY_BROWSER_STORAGE_KEYS]) {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(key) || '[]')
      if (Array.isArray(parsed) && parsed.length) return parsed as AtlasItem[]
    } catch { /* Ignore a corrupt/obsolete browser cache; the local workspace remains authoritative. */ }
  }
  return []
}

function openBrowserDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB indisponível neste navegador.'))
      return
    }
    const request = window.indexedDB.open(BROWSER_DB_NAME, BROWSER_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(BROWSER_DB_STORE)) db.createObjectStore(BROWSER_DB_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'))
    request.onblocked = () => reject(new Error('O armazenamento local está bloqueado por outra janela do Atlas.'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Falha ao consultar o armazenamento local.'))
  })
}

async function writeBrowserChangesIndexedDB(changes: AtlasChanges): Promise<{ saved: number; deleted: number }> {
  const db = await openBrowserDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(BROWSER_DB_STORE, 'readwrite')
      const store = transaction.objectStore(BROWSER_DB_STORE)
      for (const id of changes.deletedIds) store.delete(id)
      for (const item of changes.upserts) store.put(item)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('Falha ao gravar os dados.'))
      transaction.onabort = () => reject(transaction.error || new Error('Gravação cancelada.'))
    })
    return { saved: changes.upserts.length, deleted: changes.deletedIds.length }
  } finally {
    db.close()
  }
}

async function readBrowserItems(): Promise<AtlasItem[]> {
  try {
    const db = await openBrowserDatabase()
    try {
      let items = await requestResult(db.transaction(BROWSER_DB_STORE, 'readonly').objectStore(BROWSER_DB_STORE).getAll()) as AtlasItem[]
      // Import the previous Alpha workspace exactly once. IndexedDB has a much
      // larger quota and avoids the common 5 MB limit when images are embedded in cards.
      if (window.localStorage.getItem(BROWSER_MIGRATION_KEY) !== '1') {
        if (!items.length) {
          const legacyItems = parseLegacyLocalItems()
          if (legacyItems.length) {
            await writeBrowserChangesIndexedDB({ upserts: legacyItems, deletedIds: [] })
            items = legacyItems
          }
        }
        window.localStorage.setItem(BROWSER_MIGRATION_KEY, '1')
      }
      return items
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn('Atlas: IndexedDB indisponível; usando armazenamento de compatibilidade.', error)
    return parseLegacyLocalItems()
  }
}

async function saveBrowserChanges(changes: AtlasChanges): Promise<{ saved: number; deleted: number }> {
  try {
    return await writeBrowserChangesIndexedDB(changes)
  } catch (error) {
    // Last-resort compatibility path for restricted browsers. This fallback is less
    // suitable for image-heavy canvases, but keeps text edits available.
    console.warn('Atlas: falha no IndexedDB; tentando localStorage.', error)
    const entries = new Map((await readBrowserItems()).map((item) => [item.id, item]))
    changes.deletedIds.forEach((id) => entries.delete(id))
    changes.upserts.forEach((item) => entries.set(item.id, item))
    window.localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify([...entries.values()]))
    return { saved: changes.upserts.length, deleted: changes.deletedIds.length }
  }
}

const bridge: AtlasBridge = {
  platform: 'windows',
  version: '1.4.0-alpha.1',
  workspace: {
    load: async () => {
      if (isTauri) return invoke<{ formatVersion: number; items: AtlasItem[] }>('load_workspace')
      return { formatVersion: 1, items: await readBrowserItems() }
    },
    save: async (changes) => {
      if (isTauri) return invoke('save_workspace', { changes })
      return saveBrowserChanges(changes)
    },
    closeReady: (saved) => {
      flushRequested = false
      if (!isTauri || !currentWindow) return
      if (saved) {
        allowNextClose = true
        void currentWindow.close()
      } else {
        failureListeners.forEach((callback) => callback())
      }
    },
  },
  onFlushRequest(callback) {
    if (!isTauri || !currentWindow) return () => {}
    flushCallback = callback
    if (!closeListenerInstalled) {
      closeListenerInstalled = true
      void currentWindow.onCloseRequested((event) => {
        if (allowNextClose) {
          allowNextClose = false
          return
        }
        event.preventDefault()
        if (flushRequested) return
        flushRequested = true
        flushCallback?.()
      })
    }
    return () => {
      if (flushCallback === callback) flushCallback = undefined
    }
  },
  onFlushFailure(callback) {
    failureListeners.add(callback)
    return () => failureListeners.delete(callback)
  },
  onMenuAction(_callback) {
    return () => {}
  },
}

window.atlas = bridge
