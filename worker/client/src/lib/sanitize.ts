import DOMPurify from 'dompurify'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG') {
    node.setAttribute('loading', 'lazy')
  }
})

const PURIFY_CONFIG = {
  FORBID_TAGS: ['iframe'],
  ADD_TAGS: ['picture', 'source'],
  ADD_ATTR: ['loading', 'srcset', 'media', 'type'],
}

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, PURIFY_CONFIG) as string
}
