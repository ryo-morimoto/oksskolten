import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { safeFetch } from './ssrf.js'
import { USER_AGENT } from './http.js'
import { getSetting } from '../db/settings.js'
import { updateArticleContent, markImagesArchived, clearImagesArchived } from '../db/articles.js'
import { logger } from '../logger.js'
import { dataPath } from '../paths.js'

const log = logger.child('fetcher')

// Default images directory, can be overridden by settings
function getImagesDir(): string {
  const custom = getSetting('images.storage_path')
  return custom || dataPath('articles', 'images')
}

function getMaxSizeBytes(): number {
  const val = getSetting('images.max_size_mb')
  return (val ? Number(val) : 10) * 1024 * 1024
}

export function isImageArchivingEnabled(): boolean {
  const enabled = getSetting('images.enabled')
  return enabled === '1' || enabled === 'true'
}

export interface RemoteUploadConfig {
  uploadUrl: string
  headers: Record<string, string>
  fieldName: string
  respPath: string
}

export function getRemoteConfig(): RemoteUploadConfig | null {
  const mode = getSetting('images.storage')
  if (mode !== 'remote') return null

  const uploadUrl = getSetting('images.upload_url')
  const respPath = getSetting('images.upload_resp_path')
  if (!uploadUrl || !respPath) return null

  const fieldName = getSetting('images.upload_field') ?? 'image'
  let headers: Record<string, string> = {}
  const headersRaw = getSetting('images.upload_headers')
  if (headersRaw) {
    try {
      headers = JSON.parse(headersRaw)
    } catch {
      return null
    }
  }

  return { uploadUrl, headers, fieldName, respPath }
}

export function extractByDotPath(obj: unknown, dotPath: string): unknown {
  const keys = dotPath.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname).split('?')[0].toLowerCase()
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'].includes(ext)) {
      return ext
    }
  } catch {
    // ignore
  }
  return '.jpg'
}

async function uploadImageToRemote(
  buffer: Buffer,
  filename: string,
  config: RemoteUploadConfig,
): Promise<string | null> {
  try {
    const ext = path.extname(filename).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    }
    const mime = mimeMap[ext] ?? 'image/jpeg'
    const formData = new FormData()
    formData.append(config.fieldName, new Blob([new Uint8Array(buffer)], { type: mime }), filename)

    const res = await safeFetch(config.uploadUrl, {
      method: 'POST',
      headers: config.headers,
      body: formData,
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      log.warn(`Remote image upload failed: ${res.status}`)
      return null
    }

    const json = await res.json()
    const url = extractByDotPath(json, config.respPath)
    if (!url || typeof url !== 'string') {
      log.warn(`Could not extract URL from remote response at path "${config.respPath}"`)
      return null
    }
    return url
  } catch (err) {
    log.warn('Remote image upload error:', err)
    return null
  }
}

/**
 * Archive images from an article's markdown full_text.
 * Downloads each image, saves locally or uploads remotely, and rewrites the markdown URLs.
 */
export async function archiveArticleImages(
  articleId: number,
  fullText: string,
): Promise<{ rewrittenText: string; downloaded: number; errors: number }> {
  const maxSize = getMaxSizeBytes()
  const remoteConfig = getRemoteConfig()
  const isRemoteMode = getSetting('images.storage') === 'remote'

  // Remote mode but config is incomplete → skip
  if (isRemoteMode && !remoteConfig) {
    clearImagesArchived(articleId)
    return { rewrittenText: fullText, downloaded: 0, errors: 0 }
  }

  if (!isRemoteMode) {
    const imagesDir = getImagesDir()
    fs.mkdirSync(imagesDir, { recursive: true })
  }

  // Match markdown images: ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  const replacements: Array<{ original: string; replacement: string }> = []
  let downloaded = 0
  let errors = 0

  while ((match = imageRegex.exec(fullText)) !== null) {
    const [fullMatch, alt, imageUrl] = match

    // Skip already-local URLs
    if (imageUrl.startsWith('/api/articles/images/')) continue
    // Skip data URIs
    if (imageUrl.startsWith('data:')) continue

    try {
      const res = await safeFetch(imageUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        errors++
        continue
      }

      const contentLength = res.headers.get('content-length')
      if (contentLength && Number(contentLength) > maxSize) {
        errors++
        continue
      }

      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length > maxSize) {
        errors++
        continue
      }

      const hash = crypto.createHash('sha256').update(imageUrl).digest('hex').slice(0, 12)
      const ext = extFromUrl(imageUrl)
      const filename = `${articleId}_${hash}${ext}`

      if (remoteConfig) {
        const remoteUrl = await uploadImageToRemote(buffer, filename, remoteConfig)
        if (remoteUrl) {
          replacements.push({ original: fullMatch, replacement: `![${alt}](${remoteUrl})` })
          downloaded++
        }
        // If upload fails, keep original URL
      } else {
        // Local mode
        const imagesDir = getImagesDir()
        const filepath = path.join(imagesDir, filename)
        fs.writeFileSync(filepath, buffer)
        downloaded++
        const localUrl = `/api/articles/images/${filename}`
        replacements.push({ original: fullMatch, replacement: `![${alt}](${localUrl})` })
      }
    } catch {
      errors++
    }
  }

  let rewrittenText = fullText
  for (const { original, replacement } of replacements) {
    rewrittenText = rewrittenText.replace(original, replacement)
  }

  // Update article content and mark as archived
  if (replacements.length > 0) {
    updateArticleContent(articleId, { full_text: rewrittenText })
  }
  markImagesArchived(articleId)

  return { rewrittenText, downloaded, errors }
}

/**
 * Delete archived images for an article.
 */
export function deleteArticleImages(articleId: number): number {
  const imagesDir = getImagesDir()
  if (!fs.existsSync(imagesDir)) return 0

  const prefix = `${articleId}_`
  const files = fs.readdirSync(imagesDir).filter(f => f.startsWith(prefix))
  for (const file of files) {
    fs.unlinkSync(path.join(imagesDir, file))
  }
  return files.length
}
