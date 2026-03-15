# Oksskolten 実装仕様書 — チャット

> [概要に戻る](./01_overview.ja.md)

## チャット

対話型チャット機能。ユーザーは自然言語で記事の検索・分析・おすすめ取得などを行える。

### アーキテクチャ

MCP サーバーにツールを集約し、4種類のバックエンドから共通のツールセットを利用する。

```
┌──────────────────────────────────────────────────────────────────┐
│  Docker Container                                                │
│                                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐      │
│  │ Fastify  │───▶│ ChatService  │───▶│    MCP Server     │      │
│  │ API      │    │ (adapter)    │    │ (共通ツール提供層)  │      │
│  └──────────┘    └──────┬───────┘    └─────────┬─────────┘      │
│                         │                      │                 │
│         ┌───────────────┼───────────────┐      │                 │
│         ▼               ▼               ▼      ▼                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐          │
│  │Anthropic │  │  Gemini  │  │  OpenAI  │  │ SQLite │          │
│  │ Adapter  │  │ Adapter  │  │ Adapter  │  │        │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┘          │
│       │              │              │                             │
│  ┌────────────────┐  │              │                             │
│  │ ClaudeCodeAdpt │  │              │                             │
│  └───────┬────────┘  │              │                             │
│          │           │              │                             │
└──────────┼───────────┼──────────────┼─────────────────────────────┘
           ▼           ▼              ▼
   Anthropic API   Google AI API   OpenAI API
```

| バックエンド | 通信経路 | 備考 |
|---|---|---|
| **Anthropic API** (デフォルト) | Fastify → Anthropic API（MCP ツールを tool_use に変換） | `anthropic.messages.stream()` で SSE 配信 |
| **Google Gemini** | Fastify → Google GenAI API（MCP ツールを function calling に変換） | Gemini 2.5 Flash / Pro 対応 |
| **OpenAI** | Fastify → OpenAI API（MCP ツールを tool calling に変換） | GPT-5.2 / GPT-4.1 等対応 |
| **Claude Code** | Fastify → `claude -p` サブプロセス（MCP サーバーを stdio 接続） | ツールログを一時 JSONL ファイルから復元 |

バックエンド選択は設定 UI から切替可能（DB の `ai.chat_provider` に保存）。

### ファイル構成

```
server/chat/
├── adapter.ts                 # ルーター: バックエンド選択 + runChatTurn()
├── adapter-anthropic.ts       # Anthropic API アダプター
├── adapter-gemini.ts          # Google Gemini API アダプター
├── adapter-openai.ts          # OpenAI API アダプター
├── adapter-claude-code.ts     # Claude Code アダプター
├── history.ts                 # 会話履歴の正規化・修復
├── mcp-server.ts              # MCP サーバー本体（stdio transport）
└── tools.ts                   # ツール定義（ToolDef 中立形式）
```

### MCP ツール

ツール定義は `server/chat/tools.ts` で中立な `ToolDef` 形式で管理し、`toAnthropicTools()`, `toOpenAITools()`, `toGeminiTools()` で各プロバイダー固有の形式に変換する。

| ツール名 | 説明 | 入力 |
|---|---|---|
| `search_articles` | 記事を検索（Meilisearch 全文検索・フィード・カテゴリ・日付範囲・未読/いいね/ブックマーク） | `{ query?, feed_id?, category_id?, unread?, liked?, bookmarked?, since?, until?, limit? }` |
| `get_article` | 記事の詳細（full_text, full_text_ja 含む）を取得 | `{ article_id }` |
| `get_similar_articles` | 指定記事に類似する記事を Meilisearch で検索 | `{ article_id, limit? }` |
| `get_user_preferences` | ユーザーの閲読傾向を取得（トップフィード・カテゴリ・最近のいいね/ブックマーク・カテゴリ別閲読率・無視されているフィード） | `{}` |
| `get_recent_activity` | ユーザーの最近のアクティビティを時系列で取得（read/liked/bookmarked） | `{ type?, limit? }` |
| `get_feeds` | フィード一覧（記事数・未読数付き）を取得 | `{}` |
| `get_categories` | カテゴリ一覧を取得 | `{}` |
| `get_reading_stats` | 閲読統計を取得 | `{ since?, until? }` |
| `mark_as_read` | 記事を認知済み（seen）にする | `{ article_id }` |
| `toggle_like` | 記事のいいね状態をトグル | `{ article_id }` |
| `toggle_bookmark` | 記事のブックマーク状態をトグル | `{ article_id }` |
| `summarize_article` | 記事を要約する（キャッシュ確認後に実行） | `{ article_id }` |
| `translate_article` | 記事を翻訳する（キャッシュ確認後に実行） | `{ article_id }` |

MCP サーバー（`server/chat/mcp-server.ts`）は直接実行時に stdio transport で起動し、Claude Code から接続される。

### Claude Code から MCP サーバーを使う

MCP サーバーを Claude Code から直接利用でき、Web UI と同じチャット体験が得られる。データディレクトリは以下の優先順で解決される:

1. `DATA_DIR` 環境変数
2. `./data`（プロジェクトディレクトリまたは Docker コンテナ内）
3. `~/.oksskolten/data/`（スタンドアロン時のフォールバック）

#### 方法 1: ローカル開発（Node.js が必要）

リポジトリに `.mcp.json` が含まれているため、クローンして `npm install` するだけで利用可能。Claude Code が自動的に MCP サーバーを検出・接続する。

```json
// .mcp.json（リポジトリに同梱）
{
  "mcpServers": {
    "oksskolten": {
      "command": "npx",
      "args": ["tsx", "server/chat/mcp-server.ts"]
    }
  }
}
```

#### 方法 2: Docker ワンライナー（Node.js 不要）

1コマンドで MCP サーバーをユーザーレベルにインストールできる:

```bash
claude mcp add --scope user --transport stdio oksskolten \
  -- docker run -i --rm -v ~/.oksskolten/data:/app/data babarot/oksskolten \
  npx tsx server/chat/mcp-server.ts
```

これにより、どのプロジェクトからでも RSS リーダーのツールが利用可能になる。データは `~/.oksskolten/data/` に保存される。

手動で設定する場合は、Claude Code の MCP 設定（`~/.claude.json` またはプロジェクトの `.mcp.json`）に以下を追加する:

```json
{
  "mcpServers": {
    "oksskolten": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "~/.oksskolten/data:/app/data",
        "babarot/oksskolten",
        "npx", "tsx", "server/chat/mcp-server.ts"
      ]
    }
  }
}
```

#### 方法 3: 本番サーバーに SSH して利用

本番環境で `.env` に `DATA_DIR=$HOME/.oksskolten/data` を設定して `docker compose up` している場合、SSH して `claude` を起動するだけで記事を問い合わせできる。MCP サーバーは Docker コンテナが書き込んでいる同じ `~/.oksskolten/data/rss.db` を読む（SQLite WAL モードにより読み取りは並行可能）。

本番サーバーでのセットアップ:

```bash
# MCP サーバーをインストール（初回のみ）
claude mcp add --scope user --transport stdio oksskolten \
  -- docker run -i --rm -v ~/.oksskolten/data:/app/data babarot/oksskolten \
  npx tsx server/chat/mcp-server.ts
```

以降は任意のディレクトリから:

```bash
ssh prod-server
claude  # MCP ツールがすぐに使える
```

#### 方法 4: ローカル Claude Code → リモート本番サーバー

SSH せずに、ローカルの Claude Code から本番サーバーのデータベースに接続する。SSH を stdio トランスポートとしてラップし、リモートの Docker コンテナの stdin/stdout が MCP チャネルになる。

```bash
claude mcp add --scope user --transport stdio oksskolten \
  -- ssh prod-server docker run -i --rm \
  -v ~/.oksskolten/data:/app/data babarot/oksskolten \
  npx tsx server/chat/mcp-server.ts
```

SSH 鍵認証が必要（パスワード入力が入ると stdio が壊れる）。

### Anthropic API アダプター

`server/chat/adapter-anthropic.ts`。`anthropic.messages.stream()` でストリーミングし、最大10ラウンドのツールループを実行する。

- ツール結果を収集してループバック
- SSE イベント: `text_delta`, `tool_use_start`, `tool_use_end`, `done`, `error`
- メッセージは Anthropic `MessageParam` 形式で DB に保存

### Claude Code アダプター

`server/chat/adapter-claude-code.ts`。`claude -p` をサブプロセスとして起動し、`--output-format stream-json` で出力を受け取る。

- 会話履歴はテキストプロンプトとして構築（`buildPrompt()`）
- MCP サーバーを stdio 接続（MCP 設定を JSON で CLI 引数に渡す）
- ツール実行ログを一時 JSONL ファイルから読み取り、`tool_use` / `tool_result` ブロックを復元
- 90秒タイムアウト（超過時 SIGKILL）

### 検索アーキテクチャ

`search_articles` ツールは Meilisearch 全文検索と構造化フィルタを組み合わせる。

```
ユーザー: 「先週読んだCloudflareの記事なんだっけ」
                │
                ▼
┌──────────────────────────────┐
│  LLM (Claude)                │
│  自然言語 → 構造化クエリ分解   │
└──────────┬───────────────────┘
           ▼
┌───────────────────────────────────────┐
│  search_articles ツール                │
│  1. query あり → Meilisearch 全文検索  │
│     - feed_id/category_id/since/until │
│       → Meilisearch filter            │
│     - unread/liked/bookmarked         │
│       → SQLite 後段フィルタ            │
│  2. query なし → SQLite WHERE 句      │
└───────────────────────────────────────┘
```

**Meilisearch 検索**: `title`, `full_text`, `full_text_ja` を検索対象とし、タイポ耐性・関連性ランキング付きの全文検索を行う。検索インデックス未構築時は SQLite LIKE フォールバック。

### DB スキーマ

`conversations` / `chat_messages` のスキーマは [10_schema.md](./10_schema.ja.md) を参照。

`content` カラムは Anthropic API の `messages` 形式を JSON でそのまま保存する（テキスト、`tool_use`、`tool_result` を含む）。DB から読み出した messages をそのまま Anthropic API に渡して会話を再開できる。

| ケース | `article_id` | `title` |
|---|---|---|
| 通常チャット | `NULL` | 最初のメッセージから自動生成 |
| 記事内チャット | 記事ID | 記事タイトルを初期値に |

### API エンドポイント

#### `POST /api/chat`

チャットメッセージを送信し、レスポンスを SSE ストリームで返す。

```
Request:
  { "message": "...", "conversation_id?": "uuid", "article_id?": 123 }

Response: SSE stream
  data: { "type": "conversation_id", "conversation_id": "uuid" }
  data: { "type": "text_delta", "text": "今週の" }
  data: { "type": "tool_use_start", "name": "search_articles" }
  data: { "type": "tool_use_end", "name": "search_articles" }
  data: { "type": "done" }
```

処理フロー:
1. `conversation_id` がなければ新規会話を作成（UUID 生成）
2. DB から過去のメッセージを取得し、会話履歴の整合性を修復
3. 選択中のバックエンドでチャットターンを実行（SSE でストリーミング）
4. ユーザーメッセージとアシスタントレスポンスを `chat_messages` に保存
5. 最初のメッセージから会話タイトルを自動生成

#### `GET /api/chat/conversations`

会話一覧を取得。`?article_id=123` で記事内チャットをフィルタ可能。

#### `GET /api/chat/:id/messages`

会話のメッセージ一覧を取得（表示用に `tool_use` / `tool_result` をフィルタ）。

#### `DELETE /api/chat/:id`

会話とメッセージを削除（`ON DELETE CASCADE`）。

#### `GET /api/chat/suggestions`

会話のきっかけとなるサジェスチョンを取得。時間帯（朝/昼/夜）・未読数・閲読傾向に基づいて動的に生成する。

```json
// Response: 200
{
  "suggestions": [
    { "key": "suggestion.morning.newArticles" },
    { "key": "suggestion.unreadMany", "params": { "count": 55 } },
    { "key": "suggestion.topCategory", "params": { "category": "Tech" } }
  ]
}
```

`key` は i18n キー。フロントエンドが `t()` で表示テキストに変換する。

#### `GET /api/chat/claude-code-status`

Claude Code のログイン状態を確認。`{ loggedIn, email?, plan? }` を返す。

#### `GET /api/settings/api-keys/:provider`

プロバイダー（`anthropic`, `gemini`, `openai`, `google-translate`）の API キー設定状態を確認。`{ configured: boolean }` を返す。

#### `POST /api/settings/api-keys/:provider`

プロバイダーの API キーを保存・削除。`{ apiKey?: string }`（空で削除）。

#### `GET /api/settings/google-translate/usage`

Google Translate の月間使用文字数を返す。`{ month: "2026-03", chars: 12345 }`。

### フロントエンド

#### ChatPanel コンポーネント

Home チャットと記事内チャットで共有する。

```typescript
interface ChatPanelProps {
  variant: 'full' | 'inline'
  articleId?: number
  conversationId?: string
  onConversationCreated?: (id: string) => void
}
```

| variant | 用途 | 表示 |
|---|---|---|
| `full` | ChatPage 用 | 全高表示 |
| `inline` | 記事内 Callout 用 | 最大400px、ポータルで拡大表示可（Esc で閉じる） |

- `useChat()` フックでメッセージ・ストリーミング状態・会話IDを管理
- Enter で送信、Shift+Enter で改行
- ツール実行中はツール名を表示
- 記事内チャットは `article_id` で既存会話を自動ロード

#### ChatPage (`/chat`)

左サイドバーに会話一覧、右に `ChatPanel` (variant=`full`) を配置。

- 会話の作成・選択・削除
- `/chat/:conversationId` でルーティング
- 日付表示付きの会話リスト

#### ChatFab（フローティングチャットUI）

`ChatFab` コンポーネントは記事詳細画面の右下にフローティングボタンを表示する。

- クリックで `ChatPanel` (variant=`inline`) をインラインで開く
- 記事に既存の会話がある場合はバッジアイコンを表示
- デスクトップでは既存会話がある場合に自動でパネルを開く
- パネルの表示/非表示を切り替えても状態は保持される

#### 記事内チャット

`ArticleDetail` コンポーネントに `ChatFab` を配置。記事に既存の会話がある場合は自動でチャットパネルを開く。システムプロンプトに記事タイトル・要約を含めて LLM に送信する。

#### 設定ページ

AI・翻訳設定セクション（`/settings/integration` タブ）:

**タスク別設定**:
- **チャット**: プロバイダー（Anthropic / Gemini / OpenAI / Claude Code）とモデルを選択
- **要約**: チャットとは独立してプロバイダー/モデルを選択可能
- **翻訳**: LLMプロバイダーと翻訳サービス（Google Translate）をモード切替で選択。Google Translate選択時はモデル選択が非表示になる

**APIキー管理**:
- LLMプロバイダー: Anthropic / Gemini / OpenAI のキー設定・削除 + 設定状態インジケータ
- 翻訳サービス: Google Translate のキー設定 + v2/v3の違い・無料枠の注釈表示 + 月間使用文字数表示

設定は `chat.provider`, `chat.model`, `summary.provider`, `summary.model`, `translate.provider`, `translate.model` で DB に永続化。APIキーは `api_key.anthropic`, `api_key.gemini`, `api_key.openai`, `api_key.google_translate` で保存。


