import { createServer } from 'node:http'
import kuromoji from 'kuromoji'

const PORT = 3000

// POS tags to keep for search tokens
const SEARCH_POS = new Set(['名詞', '動詞', '形容詞'])
// POS tag for trigram dictionary
const NOUN_POS = '名詞'

/** @type {import('kuromoji').Tokenizer<import('kuromoji').IpadicFeatures> | null} */
let tokenizer = null

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji
      .builder({ dicPath: 'node_modules/kuromoji/dict/' })
      .build((err, tok) => {
        if (err) reject(err)
        else resolve(tok)
      })
  })
}

/**
 * @param {string} text
 * @returns {{ tokens: string, nouns: string[] }}
 */
function tokenize(text) {
  if (!tokenizer) throw new Error('Tokenizer not ready')
  const result = tokenizer.tokenize(text)

  const searchTokens = []
  const nouns = []

  for (const token of result) {
    if (SEARCH_POS.has(token.pos)) {
      // Use surface_form (original text) for search
      searchTokens.push(token.surface_form)
    }
    if (token.pos === NOUN_POS && token.surface_form.length >= 2) {
      nouns.push(token.surface_form)
    }
  }

  return {
    tokens: searchTokens.join(' '),
    nouns,
  }
}

/** @param {import('node:http').IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (url.pathname === '/tokenize' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req))
      const text = body.text
      if (typeof text !== 'string' || text.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'text is required' }))
        return
      }

      const result = tokenize(text)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

// Build tokenizer then start server
buildTokenizer()
  .then((tok) => {
    tokenizer = tok
    server.listen(PORT, () => {
      console.log(`kuromoji server listening on :${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Failed to build tokenizer:', err)
    process.exit(1)
  })
