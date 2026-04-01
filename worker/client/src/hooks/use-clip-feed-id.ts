import useSWR from 'swr'
import { fetcher } from '../lib/fetcher'

/** Returns the clip feed ID from the /api/feeds endpoint (cached by SWR). */
export function useClipFeedId(): number | null {
  const { data } = useSWR<{ clip_feed_id: number | null }>('/api/feeds', fetcher)
  return data?.clip_feed_id ?? null
}
