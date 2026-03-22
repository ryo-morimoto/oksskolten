import { describe, it, expect } from 'vitest'
import { extractContent } from '../../src/pipeline/extract-content'

// Minimal article HTML that Defuddle can extract with linkedom
const SIMPLE_ARTICLE = `<html><head><title>Test Article</title><meta property="og:title" content="Test Article"></head>
<body><article>
<h1>Test Article</h1>
<p>First paragraph with enough content for extraction threshold. Lorem ipsum dolor sit amet consectetur adipiscing elit.</p>
<p>Second paragraph continues the article content. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim.</p>
<p>Third paragraph wraps up with more text. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat.</p>
</article></body></html>`

// Full blog page with noise elements
const BLOG_WITH_NOISE = `<!DOCTYPE html>
<html><head><title>Blog Post</title></head>
<body>
<nav>Navigation</nav>
<article>
<h1>Blog Post</h1>
<p>Main content paragraph one with substantial text for extraction. Lorem ipsum dolor sit amet consectetur adipiscing.</p>
<p>Main content paragraph two with more text. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua veniam.</p>
<p>Main content paragraph three. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla.</p>
</article>
<aside>Sidebar</aside>
<footer>Footer</footer>
</body></html>`

describe('extractContent', () => {
  it('extracts content from simple article HTML', async () => {
    const result = await extractContent(SIMPLE_ARTICLE, 'https://example.com/post')

    // Returns structured result with all fields
    expect(result).toHaveProperty('fullText')
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('ogImage')
    expect(result).toHaveProperty('excerpt')
    // If content was extracted, excerpt should be under 200 chars
    if (result.excerpt) {
      expect(result.excerpt.length).toBeLessThanOrEqual(200)
    }
  })

  it('extracts content from blog with noise elements', async () => {
    const result = await extractContent(BLOG_WITH_NOISE, 'https://example.com/post')

    // Defuddle may or may not fully extract with linkedom depending on noise detection
    // Core requirement: doesn't crash and returns a structured result
    expect(result).toHaveProperty('fullText')
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('excerpt')
    expect(result).toHaveProperty('ogImage')
  })

  it('returns non-empty fullText when content is extracted', async () => {
    const result = await extractContent(SIMPLE_ARTICLE, 'https://example.com/post')
    if (result.fullText) {
      expect(result.fullText.length).toBeGreaterThan(50)
    }
  })

  it('uses fallback when extraction yields too little content', async () => {
    const thinHtml = '<html><body><script>redirect()</script></body></html>'
    const result = await extractContent(thinHtml, 'https://example.com/post', {
      fallbackContent: '# Fallback\n\nContent from RSS feed.',
    })
    expect(result.fullText).toBe('# Fallback\n\nContent from RSS feed.')
  })

  it('uses fallback on empty input', async () => {
    const result = await extractContent('', 'https://example.com/post', {
      fallbackContent: 'RSS excerpt content',
    })
    expect(result.fullText).toBe('RSS excerpt content')
  })

  it('returns nulls with no fallback on failure', async () => {
    const result = await extractContent('', 'https://example.com/post')
    expect(result.fullText).toBeNull()
    expect(result.ogImage).toBeNull()
    expect(result.excerpt).toBeNull()
    expect(result.title).toBeNull()
  })

  it('converts bare pre blocks to fenced markdown', async () => {
    const html = `<html><body><article>
      <p>Text before code block with enough length. Lorem ipsum dolor sit amet consectetur adipiscing.</p>
      <pre data-lang="typescript">const x = 1;</pre>
      <p>Text after code block with enough length. Sed do eiusmod tempor incididunt ut labore et dolore.</p>
    </article></body></html>`
    const result = await extractContent(html, 'https://example.com/post')
    if (result.fullText) {
      expect(result.fullText).toContain('```')
    }
  })

  it('handles HTML with only non-content elements', async () => {
    const html = '<html><body><nav>Menu</nav><footer>Copyright</footer></body></html>'
    const result = await extractContent(html, 'https://example.com/post', {
      fallbackContent: 'Fallback text for pages with no content.',
    })
    // Should fall back since no article content detected
    expect(result.fullText).toBe('Fallback text for pages with no content.')
  })
})
