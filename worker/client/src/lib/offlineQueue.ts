const DB_NAME = 'reader-offline'
const STORE_NAME = 'read-queue'
const DB_VERSION = 1

/** Server enforces this limit on batch-seen */
const BATCH_SIZE = 100

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function queueSeenIds(ids: number[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  for (const articleId of ids) {
    store.add({ articleId, ts: Date.now() })
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

let flushing = false

export async function flushOfflineQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    await doFlush()
  } finally {
    flushing = false
  }
}

async function doFlush(): Promise<void> {
  const db = await openDB()

  // Read all queued items
  const items = await new Promise<Array<{ id: number; articleId: number }>>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  if (items.length === 0) return

  const ids = [...new Set(items.map(i => i.articleId))]

  // Send in chunks of BATCH_SIZE to stay within server limit
  const { authHeaders } = await import('./fetcher')
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE)
    const res = await fetch('/api/articles/batch-seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ids: chunk }),
    })
    if (!res.ok) throw new Error('flush failed')
  }

  // Clear the queue only after all chunks succeed
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).clear()
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
