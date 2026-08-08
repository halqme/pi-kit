# Astrolabe

Astrolabeは、対応言語の既存ソースに対して編集対象をヒューリスティックに特定し、構文ノードをcontinuationとして保持したまま安全に変更するPi拡張です。Tree-sitterは対象を具体的な構文ノードへ固定するために使い、利用可能な場合はLSPの意味情報もtarget resolutionへ加えます。

Astrolabeがコードで強制するのは、continuationの有効性、対象のstaleness、構文整合性、置換範囲、atomic writeなど機械的に判定できる条件です。「本文を読むべきか」「どの変更が意味的に正しいか」はモデル側の判断です。

## `astrolabe` tool

`action`で`locate`、`search`、`inspect`、`inspect_many`、`replace`、`replace_many`、`rename`を選びます。

- `locate`は編集意図に含まれる`symbols`または`terms`から宣言ノードを順位付けします。Tree-sitterの構造・本文signalと、利用可能なLSPの`workspace/symbol`を独立したcandidate generatorとして並行して使い、同じconcrete syntax nodeを支持するevidenceは加算してconfidenceを上げます。LSPが利用できなければstructural/textual signalだけで同じ処理を続行します。完全一致symbolで明確に首位かつ本文が6,000 bytes以下なら`mode: "source"`として本文も返し、それ以外は`mode: "cards"`としてシグネチャ、親宣言、flow、範囲、continuationを返します。
- `search`は構文形状による補助探索です。関数・呼出し・importを検索し、`locate`で対象を特定できない調査に使います。
- `inspect`は`path`でoutlineを取得するか、continuationで選んだ構文ノードのsourceを取得します。
- `inspect_many`は同一ファイルの複数continuationを一度にsourceまで取得し、`replace_many`用のテンプレートを返します。
- `replace`は有効なcontinuationと完全な`replacement`を受け、現在のsource hash、ノード型・範囲・親文脈を再検証してから保存します。
- `replace_many`は同一ファイル内の複数continuationを全件検証し、置換後の構文検査に成功した場合だけatomicに保存します。
- `rename`は宣言continuationと`newName`を受け、LSPの`textDocument/rename`に意味論的なWorkspaceEditを生成させます。AstrolabeはWorkspaceEditを即適用せず、対象ファイルのstaleness、範囲重複、対応言語、置換後の構文を検証してからcommitします。

```json
{ "action": "locate", "scope": "packages/session-metrics/src", "symbols": ["SessionStore.refresh"], "terms": ["metrics", "refresh"] }
```

```json
{ "action": "rename", "continuation": { "token": "..." }, "newName": "refreshMetrics" }
```

## Target Resolution と Mutation Model

LSPを追加してもmutation modelは変わりません。通常の編集は次の経路です。

```text
edit intent
  -> target resolution
       |- LSP semantic evidence
       |- Tree-sitter structural evidence
       `- textual evidence
  -> candidate fusion / ranking
  -> concrete syntax node
  -> continuation
  -> replace / replace_many
  -> stale + syntax validation
  -> commit
```

LSPとTree-sitterに主従関係はありません。利用可能なresolverは最初からevidenceを出し、同じnodeを複数のsignalが支持した場合はranking上のconfidenceが高くなります。LSPのURI/rangeも最終的にはTree-sitter declarationへanchorされるため、mutation layerはresolver固有の位置表現を扱いません。

renameのように言語側で意味論が定義されている操作だけは、mutation proposalの生成をLSPへ委譲します。

```text
continuation
  -> declaration name position
  -> LSP textDocument/rename
  -> WorkspaceEdit
  -> Astrolabe validation / staging / commit
```

つまりLSPはAstrolabeのmutation safetyを置き換えず、「どこを編集するか」と「意味論的refactoringでどの編集集合が必要か」を補強します。

## LSP

LSPは任意機能です。Astrolabeはlanguage serverを自動インストールしません。PATH上で次のサーバーを順に試します。

- TypeScript / JavaScript: `typescript-language-server --stdio`
- Go: `gopls`
- Python: `basedpyright-langserver --stdio`、次に`pyright-langserver --stdio`

`locate`はLSPが設定されている言語ではTree-sitterとLSPを並行して使います。LSPを起動できない場合はそのsemantic signalだけを欠いた状態でstructural resolutionを継続します。`rename`は意味論的なWorkspaceEditが必要なので、サーバーがなければ`lsp_unavailable`を返します。現在はUTF-16 position encodingだけを受け付けます。

WorkspaceEditは既存のAstrolabe対応ソースへのtext editだけを受理します。`CreateFile`、`RenameFile`、`DeleteFile`などのresource operation、非file URI、非対応ファイルへの編集は拒否します。複数ファイルのrenameは全ファイルを先に検証・stageしてからcommitし、途中失敗時はbest-effort rollbackを行います。ファイルシステム上の複数renameを真にatomicにはできないため、rollback自体が失敗した場合は`workspace_commit_partial`として明示します。

## 推奨フロー

`next`はpermissionではなく、結果から見た通常の最短経路です。

- `locate(mode: "source")` → 通常はそのまま`replace`。同じnodeを再度`inspect`しません。
- `locate(mode: "cards")` → cardだけでreplacementが決まるなら直接`replace`。本文が必要なら選んだcardだけ`inspect`します。
- 同一ファイルの複数cardで本文が必要 → `inspect_many` → `replace_many`。
- シンボル自体のrename → `locate` → `rename`。referencesを手作業で`replace_many`しません。
- `locate`で対象を絞れない → `search`またはoutline `inspect`へ広げます。

## ハンドルと位置

continuationは短命かつセッション限定です。ハンドルはsource hash、ノード型、親宣言、祖先型、field、前後兄弟、周辺sourceを保持し、ファイル変更後も同一ノードを一意に再同定できる場合だけ通常のnode replacementを継続します。曖昧なら`stale_node`で拒否します。

`web-tree-sitter`の公開インデックスと`Point`はこのバインディングのUTF-16 JavaScript文字列位置として扱います。ハンドルには別途UTF-8バイト範囲も保存します。サロゲートペアやUTF-8コードポイントの途中は位置として受け付けません。

renameのWorkspaceEditがstaleになった場合はノードをfuzzy relocationして続行せず、semantic analysis自体をやり直すため`stale_workspace_edit`を返します。

## 言語アダプター

言語アダプターは言語ID、文法ID、WASM、拡張子、Tree-sitter Query、ノード分類に加え、任意のLSP server候補を管理します。共通処理は特定言語のserver commandをハードコードしません。

```text
languages/
└── [language]/
    ├── config.ts
    └── queries.ts
```

対応言語は`languages/*/config.ts`から起動時に読み込みます。TSXとアダプターのない言語は`unsupported_language`です。Tree-sitter WASMとParserは初回利用時に読み込み、言語IDと文法IDごとに再利用します。

## 適用範囲

Astrolabeのスコープは編集です。LSPやTree-sitterによる探索は、編集対象を具体的なmutationへ落とすための手段として扱います。一般的なコード理解、型検査、Lint、project-wide diagnosticsをAstrolabeへ取り込むことは目的にしません。

新規ファイル、生成コード、設定ファイル、非対応言語、または構文単位で扱う利点のない変更には通常のファイル生成・read・Diff/patch型編集を使います。Astrolabeの構文検査は型検査やLintの代替ではないため、編集後はプロジェクトの通常の検証を別途実行してください。

## 状態コード

- `stale_node`: continuationの対象を現在のファイルから一意に再同定できません。
- `invalid_continuation`: continuationが失効したか変更されています。
- `lsp_unavailable`: 対応language serverを起動できません。
- `rename_unavailable`: language serverまたは対象位置がrenameを受け付けません。
- `stale_workspace_edit`: LSPがWorkspaceEditを生成した後に対象ファイルが変化しました。semantic operationを再実行します。
- `unsupported_workspace_operation`: WorkspaceEditにresource operationなど未対応の変更が含まれます。
- `overlapping_workspace_edits`: LSPが重複・重なりのあるtext editを返しました。
- `workspace_commit_failed` / `workspace_commit_partial`: multi-file commitまたはrollbackに失敗しました。
- `syntax_error`: 新しい構文エラー、missing node、または通常replaceで構文型・親文脈の不一致を検出しました。
- `unsupported_language`: 対象ファイルに言語アダプターがありません。

## Development

```sh
bun run check
```

ツールのschema、説明、promptGuidelines、TUI表示を変更した場合は、Piで`/reload`を実行すると現在のセッションへ反映されます。
