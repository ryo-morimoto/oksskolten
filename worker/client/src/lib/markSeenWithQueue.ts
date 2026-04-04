import { apiPost } from '@/lib/fetcher'
import { queueSeenIds } from '@/lib/offlineQueue'

export async function markSeenOnServer(ids: number[]): Promise<void> {
  try {
    await apiPost('/api/articles/batch-seen', { ids })
  } catch {
    await queueSeenIds(ids)
  }
}
