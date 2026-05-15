---
description: X の「いいね」「ブックマーク」を取得し、判断しながら Notion Knowledge Base にまとめるワークフロー。
---

# /xmarks

X の `likes` / `bookmarks` を取得し、各ポストを Knowledge Base ノートとして妥当か判断した上で、Notion MCP 経由で Knowledge Base に追加する。

## 前提

- X 取得はこのリポジトリの bun スクリプト。先に `bun run auth` でトークン取得済みであること。
- Notion 書き込みは Notion MCP（`mcp__notion__*`）を使う。CLI は使わない。
- Knowledge Base のスキーマ・ルールは同じワークスペースの KB ルール（CLAUDE.md 等）ノートに従う。
- **Data Source ID は env から取得**: 起動直後に `Bash` で `printenv NOTION_KB_DATA_SOURCE_ID` を実行して値を確認し、以降の MCP 呼び出しで `<DS_ID>` のプレースホルダ部分に当てはめる。未設定ならエラーで停止しユーザーに `.env` 設定を促す。

## 引数

```
/xmarks [--source likes|bookmarks|both] [--limit 5..100] [--since ISO] [--until ISO] [--full] [--dry-run]
```

デフォルト: `--source both --limit 50`

### モード

通常モード（**増分同期**、デフォルト）:
- X API の返却順（**いいね/ブクマした順**、新しい順）で走査
- 各ポストの Primary Source URL を Notion で重複チェック
- **最初に既存ヒットした時点でその source の処理を打ち切り**（それ以降は前回同期済みのため）
- 「前回の `/xmarks` 以降にいいね/ブクマした分だけ取り込む」が達成される

`--full`（明示指定時のみ）:
- 全件走査。既存はスキップするが打ち切らない
- 過去ログの取り込み直しに使う

`--since` / `--until`（任意）:
- tweet の `created_at` でクライアント側フィルタ
- ⚠️ **「いつ いいね/ブクマしたか」ではなく「ツイートが投稿された時刻」**で絞る点に注意
- 用途: 「過去の特定期間に投稿されたツイートで、自分のいいね/ブクマに入っているもの」だけ拾いたい時

## ワークフロー

### 1. 取得（**X API コスト最小化**）

ユーザー指示の `source` ごとに以下を実行。`--out` でローカルキャッシュも書く。

```bash
bun run fetch --source bookmarks --limit 30 --out .xmarks/cache/bookmarks-<timestamp>.json
bun run fetch --source likes     --limit 30 --out .xmarks/cache/likes-<timestamp>.json
```

各要素は `{ pickedVia, post: { id, url, author, text, createdAt, conversationId, inReplyToPostId, media, urls, article, referencedPost } }`。

`referencedPost` は **引用元 / RT元** のツイート全体（同じ Post 構造）。**ブックマークは引用やRTを bookmark しているケースが非常に多く、その場合 referencedPost.post がメインコンテンツ**。bookmark側ポストは「メモ」「リンクのみ」のような短文であることが多い。

`urls` は entities.urls から作られる配列。`{ shortUrl, expandedUrl, displayUrl, title?, description? }`。**`expandedUrl` の中身が paper、X記事、X動画、外部記事など真のコンテンツであることが多い**。`title` / `description` がある場合はリンクカードのメタデータ（多くの外部記事で取得可能）。

`article` は **X article（長文記事ポスト）のメタデータ**。`{ title, previewText? }`。X 公式 API では title と preview_text（200-300字）までしか取れない。`post.article` または `referencedPost.post.article` のいずれかに入る。

**X article 本文全体**は `bun run article <tweet-id>` で取得可能（Grok x_search 経由）。`XAI_API_KEY` が必要、1記事あたり数円程度のコスト。tweet-id は `article` フィールドが乗っているポストの id を渡す。

**X 動画の中身**は `bun run video <tweet-id>` で取得可能（Grok の `view_x_video` ツール経由）。tweet-id は `media[].type === "video"` を持つポストの id。要 `XAI_API_KEY`。コストは1動画 $0.05-0.10 程度。Grok アプリと同じレベルの動画理解（実際に映像を見て中身を要約）。

**X 画像の中身**は `bun run image <tweet-id>` で取得可能（Grok の `view_image` ツール経由）。tweet-id は `media[].type === "photo"` を持つポストの id。要 `XAI_API_KEY`。コストは1画像 $0.03-0.07 程度。テキスト OCR（VERBATIM転記）、図表構造、コード、UI 要素まで認識。**判定で text 単独だと薄いが photo 添付ありのケース**で特に有効（paper figure、screenshot、infographic など）。

**重要事項**:
- 配列は **いいね/ブクマした順（新しい順）** で並ぶ。順番を保ったまま処理すること
- **X API は post 件数で課金される**（Basic = 月10K件）。`--limit` は控えめに（デフォルト30）
- スレッド取得は `/tweets/search/recent` で別途課金されるので、**KB 採用が決まったポストにだけ** 行う（後述 3-3）
- 同じセッション内で再実行する場合は、保存済みキャッシュ（`.xmarks/cache/*.json`）を Read で読み直して再 fetch を避ける

### 2. 既存Tags取得 + xmarks option 自動復旧
ハードコードせず、毎回 fetch する。

```
mcp__notion__notion-fetch
  id: collection://<DS_ID>
```

返ってきた `Tags.options` の `name` 配列を、以降のタグ選定の正規化リストとする。

**xmarks option の存在チェック（必須）**:

返ってきた options の name 配列に `"xmarks"` が含まれているか確認する。**含まれていなければ、ノート作成前に必ず ALTER で復旧する** — 含めずに create-pages を呼ぶと `Invalid multi_select value for property "Tags": "xmarks"` で 400 になる。

復旧手順:
```
mcp__notion__notion-update-data-source
  data_source_id: <DS_ID>
  statements: ALTER COLUMN "Tags" SET MULTI_SELECT(
    '<existing tag 1>':<color>,
    '<existing tag 2>':<color>,
    ...,
    '<existing tag N>':<color>,
    'xmarks':default
  )
```

**重要**:
- ALTER COLUMN SET は **全オプションを再定義**するので、fetch で取った既存全タグを必ず color 付きで列挙する（漏らすと既存タグが消える）
- xmarks の color は `default`（provenance 用なのでコンテンツ系の色を使わない）
- **既存ノートの xmarks 値は option 削除されても data として保持されている**（Notion は ghost 値として残す）。option 復旧と同時に再表示されるので、既存ノートの個別 update は不要

### 3. 各ポストの処理

#### 3-1. 重複チェック（増分モードでは早期打ち切りの判定にもなる）

**Primary Source の決定**（同元コンテンツの重複を吸収するため正規化）:

優先順:
1. `referencedPost.post.url` がある場合（quoted/RT）→ それを Primary Source に
2. `post.urls[]` の中に `x.com/i/article/<id>` または明確な一次情報URL（arxiv / github / 公式blog 等）があり、それが本コンテンツの本体である場合 → そちらを Primary Source に
3. 上記いずれもなければ `post.url` を Primary Source に

**検索フロー**（厳密化）:

1. notion-search でデータソースを絞って URL を投げる:
   ```
   mcp__notion__notion-search
     query: <Primary Source URL>
     data_source_url: collection://<DS_ID>
     filters: {}
     page_size: 5
   ```
2. 結果の各ヒット（id）に対し `notion-fetch` でページを取り、`Primary Source` プロパティ値が **対象URLと完全一致**するかを確認
3. 一致が1件でもあれば「既存」と確定。なければ「新規」

> notion-search は semantic なので highlight 一致だけでは false positive がある。**必ず page を fetch して Primary Source プロパティ値で完全一致確認する**こと。

**モード分岐**:
- 通常モード（増分同期）: 既存ヒット時点で **その source の残りのポスト処理は打ち切る**（それ以降は前回同期済み）
- `--full` モード: スキップカウントだけ増やして次のポストへ進む

**重複判定の効果（具体例）**:
- bookmark A が tweet X を引用、bookmark B が tweet X を直接 bookmark → 両方とも Primary Source = `<tweet X URL>` → B は重複
- 同じ X article (`x.com/i/article/<id>`) を別々の tweet 経由で bookmark → どちらも Primary Source = article URL → 後者は重複

#### 3-2. KB対象判定（**まず内容で判定**。スレッド取得より前）

判定の素材（優先順）:
1. **`article.title` / `article.previewText`**（`post.article` または `referencedPost.post.article`）— X article のメタ情報。あれば最有力
2. **`referencedPost.post.text`** — 引用元/RT元の本文
3. **`urls[].title` / `urls[].description`** — リンクカードのメタデータ
4. **`urls[].expandedUrl`** — リンク先 URL のドメイン・パス情報（特に `x.com/i/article/<id>` は X article、`paper`, `arxiv` などは論文）
5. **`post.text`** — bookmark 側のコメント
6. **`media`** — 動画/画像の存在は内容を保証しないがヒント

**保存する**:
- 1主張で完結する内容（手法・知見・観察・引用に値する論考）
- 引用元・リンクメタ情報・スレッド全体のいずれかから具体性ある知見が得られる場合
- リンクのみのポストでも、`urls[].title` で対象が「論文」「ライブラリ」「記事」と分かる場合 → 採用候補
- 文脈不足で **判定できないが具体名（paper / library / article 等）が出ている**もの → 後段でスレッド取得して再判定

**スキップする**:
- ミーム・冗談・低情報量（雑談・自己紹介・告知・宣伝）
- リンクのみで `urls[]` のメタ情報も無く、何のリンクか分からない
- リプライで文脈に依存し、かつ投稿主スレッドでもない（他人への返信単独）
- **自己引用 + リンクのみ + 引用先もリンクのみ**（実質メタ情報も無い）

判定が微妙でも、**具体名 / カードメタが取れていれば採用候補に回し**、スレッド取得で補強を試みる。

> **コスト観点**: スキップ確定なら thread fetch を省ける。微妙なものは取りに行く方針（漏れの方がコスト高）。

#### 3-3a. X article / video 本文取得（KB採用候補のとき）

XAI_API_KEY が設定されていれば、3-2 で「採用」 or 「ペンディング（画像/動画次第）」と判定した投稿に対して以下を実行:

**article がある場合** (`post.article` or `referencedPost.post.article` が存在):
```bash
bun run article <tweet-id-with-article>
```

**video がある場合** (`post.media[].type === "video"` または `referencedPost.post.media[].type === "video"`):
```bash
bun run video <tweet-id-with-video>
```

**photo がある場合** (`post.media[].type === "photo"` または `referencedPost.post.media[].type === "photo"`):
```bash
bun run image <tweet-id-with-photo>
```

特に **判定で text 単独だと薄いが photo がある場合**は、画像内のテーブル/グラフ/screenshot に重要情報があるケースが多いので **積極的に取得して再判定**する。

- tweet-id は対象が乗っているポストの id（bookmark そのものか、`referencedPost.post.id`）
- 出力は markdown 本文/要約。失敗時は exit code 2 + stderr メッセージ
- XAI_API_KEY 未設定時はスキップして既存メタ（title/previewText/text）のみで Seed ノート化

article + video / video + photo 等が複合する場合は該当するものを全部実行。

> **コスト**: Grok x_search 1-2 call + tokens で **article $0.05-0.10、video $0.07、image $0.03-0.07/件**。X API の post 課金とは別バジェット。判定確定後にだけ呼ぶことで無駄打ちを抑える。

#### 3-3b. スレッド取得（**採用 or ペンディング のとき広めに取る**）

スキップ確定でなければスレッド取得を試みる。条件は **緩め** に:

- リプライ系（`conversationId !== post.id` または `inReplyToPostId` あり）→ 文脈補完のため
- 起点ポスト（`conversationId === post.id`）でも以下のいずれかなら取得:
  - text が短い（200字未満）
  - 末尾に継続マーカー（`...` / `👇` / `🧵` / `(続く)` / `tl;dr` 等）
  - 具体名（paper / lib / article / talk / 動画タイトル）に言及があるが詳細が無い
  - referencedPost も含めて **本文が薄く、urls の title/description でも全貌が分からない**

```bash
bun run thread <conversationId> <author.id>
```

返り値が `null` ⇒ スレッドなし or 範囲外（Recent Search の7日制限）。その場合は単発として再判定。

スレッド取得後、**スレッド全体（urls/referencedPost含む）を見て再判定**。投稿主が続きで具体的な paper名/URL/解説を書いていれば採用、そうでなければスキップ。

> **コスト**: 起点ポストでも取りにいくので、スキップ判定がしっかり機能していないと無駄fetchが増える。3-2 で確実にスキップを切り落とすことが前提。

#### 3-4. ノート組み立て

**Title**: 1ノート1主張になる短い宣言文。優先順:
1. `article.title` があればそれをベースに（短くシンプルに）
2. なければ referencedPost.post の text を要約
3. なければ post の text を要約

先頭に絵文字・記号を付けない。`@username` のような出典は本文に。

**Status**: `🌱 Seed`

**Assignee**: `🤖 AI`

**Tags**: **必ず `xmarks` を含める**（このツール経由で作成したことを示す provenance タグ）。加えて、既存タグからコンテンツトピックに合うものを選定。該当がなければ `["xmarks"]` のみで OK。`xmarks` 以外の新規タグ追加はしない（必要なら後続で人間がレビュー）。

**Primary Source**: **正規化済みの一次情報URL**（3-1 の優先順で決定）。
- 引用先 URL > X article URL > post.url
- これにより「同元コンテンツを別経路で bookmark」したケースが重複として検出される
- bookmark 側 URL は本文の `## ブックマーク` セクションに記録（発見経路として）

**本文テンプレート（X article がある場合）**:

```markdown
（要約・所感を1-2文。記事本文を読んで KB に残す価値を書く）

## 記事: {article.title}

（Grok から取得した本文 markdown。取れなければ preview_text を引用）

— @{author.username} ・ {createdAt}
{post.url}

## ブックマーク（referencedPost を経由した場合のみ記載）

> {post.text}

— @{post.author.username} ・ {post.createdAt}
{post.url}

## Sources
- {一次情報URL}
  - {post.url}（発見のきっかけ、bookmark経由のとき）
```

**本文テンプレート（動画がある場合）**:

```markdown
（要約・所感を1-2文。動画の主張を踏まえて）

## 動画

（Grok video summary の markdown）

— @{author.username} ・ {createdAt}
{post.url}

## 元ポスト（コメント）

> {post.text}

## Sources
- {post.url}
```

> 取得できなかった場合は media URL とポストテキストだけで Seed ノート化。

**本文テンプレート（referencedPost あり、article なし）**:

```markdown
（要約・所感を1-2文。referencedPost.post の中身を主に要約し、なぜ KB に残すかを書く）

## 引用元（メイン）

> {referencedPost.post.text}

— @{referencedPost.post.author.username} ・ {referencedPost.post.createdAt}
{referencedPost.post.url}

## ブックマーク

> {post.text}

— @{post.author.username} ・ {post.createdAt}
{post.url}

## Sources
- {Primary Source URL}        （一次情報、Primary Source と同値）
  - {post.url}                （発見のきっかけ、bookmark 経由のとき）
```

**本文テンプレート（referencedPost なし、単発 or スレッド）**:

```markdown
（要約・所感）

## 元ポスト

> {post.text}

— @{post.author.username} ・ {post.createdAt}
{post.url}

（スレッドの場合は続けて時系列順に同形式で全ポストを並べる）

## Sources
- {post.url}
```

#### 3-5. 作成

`--dry-run` 指定時はここで作成せず、組み立てた内容を要約出力する。

```
mcp__notion__notion-create-pages
  parent: { data_source_id: "<DS_ID>" }
  pages: [
    {
      properties: {
        Title: "<title>",
        Status: "🌱 Seed",
        Assignee: "🤖 AI",
        Primary Source: "<url>",
        Tags: ["..."]
      },
      content: "<markdown body>"
    }
  ]
```

### 4. レポート

最後に以下を出力:

```
✓ created:    N
↻ skipped:    M (重複)
✗ skipped:    K (KB対象外)
× failed:     E
```

失敗した件は post URL と原因を1行ずつ列挙。

## ルール（Knowledge Base CLAUDE.md より）

- ノート作成前に必ず Primary Source URL で重複検索
- Tags はハードコード禁止、操作前に必ず fetch で現状確認
- **作成するノートには `xmarks` タグを必ず含める**（このツール経由の provenance）
- 1ノート1主張
- 未登録 Tag を使う場合は事前に `notion-update-data-source` で ALTER（**全オプション再定義注意**）。今回はデフォルトで新規追加しない
- pages: [] 空配列は無言成功するので、組み立てた配列は必ず非空を確認

## エラー時のふるまい

- `bun run fetch` が non-zero（典型: 401 や Bookmarks/Likes API 権限不足）→ 認証期限切れの可能性。`bun run auth` の再実行を案内して中断
- スレッド取得が空 → `null` をそのまま受け、本文には単発ポストとして書く
- Notion 作成失敗 → そのポストは `failed` にカウントし、次のポストへ進む

## コスト最小化のルール（運用）

- `--limit` は **30 程度をデフォルト**にし、増分モードと併用。漏れたら次回拾えばよい
- **3-2 → 3-3 の順序を厳守**（判定 → スレッド取得）。逆にすると無駄な thread fetch が発生する
- 同じセッションでの再試行・dry-run 反復は、`--out` で書いたキャッシュ（`.xmarks/cache/*.json`）を Read 経由で再利用し、fetch を再実行しない
- `--since/--until` はクライアント側フィルタなのでコスト削減にはならない（受信した post は全て課金対象）。コストを抑えたいなら `--limit` を絞る
