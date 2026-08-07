# Astrolabe

Astrolabeは、対応言語の既存ファイルを構文単位で検索・読取り・局所編集するTree-sitter拡張です。公開APIは単一の`astrolabe` toolで、モデルが必要な構造だけを扱えるようにします。

Astrolabeがコードで強制するのは、continuationの有効性、対象のstaleness、構文整合性、置換範囲、atomic writeなど機械的に判定できる条件です。「この変更を行う前に本文を読む必要があるか」は変更意図に依存する意味的判断なので、source取得はpermissionではなく情報取得手段として扱います。

## `astrolabe` tool

`action`で`locate`、`search`、`inspect`、`inspect_many`、`replace`、`replace_many`を選びます。

- `locate`は編集意図に含まれる`symbols`または`terms`から、`scope`内の宣言ノードを決定論的に順位付けします。既定では上位3件（`maxCandidates`で1〜5件）を返します。完全一致symbolで明確に首位かつ本文が6,000 bytes以下なら`mode: "source"`として本文も返し、`next`でそのcontinuationを直接`replace`できます。そうでなければ`mode: "cards"`としてシグネチャ、親宣言、呼出し・分岐・終了の概略、範囲、continuationを返します。
- `search`は`scope`に既存の対応ソースファイルまたはディレクトリを渡し、関数・呼出し・importを検索します。`locate`で対象を特定できない調査向けです。ディレクトリは対応する通常ファイルだけを再帰検索し、symlinkは辿りません。
- `inspect`は`path`でoutlineを取得するか、continuationで選んだ構文ノードのsourceを取得します。cardだけではreplacementを判断できない場合や、周辺実装を確認したい場合に使います。
- `inspect_many`は同一ファイルの複数continuationを一度にsourceまで取得します。複数のcardを編集することが既に決まっていて、それぞれの本文が必要な場合に個別の`inspect`往復をまとめます。成功時の`next`は対応する`replace_many`テンプレートです。
- `replace`は有効なcontinuationと完全な`replacement`を受け、現在のsource hash、ノード型・範囲・親文脈を再検証してから保存します。sourceを事前に取得したかどうかは書込み条件ではありません。
- `replace_many`は同一ファイル内の複数continuationを全件検証し、置換後の構文検査に成功した場合だけatomicに保存します。1件でもstale、範囲重複、構文エラーがあればファイルを変更しません。

操作結果は`content`のJSONとして返し、`details`にはmetricsなどの内部診断情報だけを含めます。continuationは短命かつセッション限定で、失効・別path・staleな対象への書込みは拒否します。

```json
{ "action": "locate", "scope": "packages/session-metrics/src", "symbols": ["SessionStore.refresh"], "terms": ["metrics", "refresh"] }
```

## 推奨フロー

`next`はpermissionではなく、結果から見た通常の最短経路です。

- `locate(mode: "source")` → 通常はそのまま`replace`。同じnodeを再度`inspect`しません。
- `locate(mode: "cards")` → cardだけでreplacementが決まるなら直接`replace`して構いません。本文が必要なら選んだcardだけを`inspect`します。
- 同一ファイルの複数cardで本文が必要 → `inspect_many` → `replace_many`。
- `locate`で対象を絞れない → `search`またはoutline `inspect`へ広げます。

この区別は、モデルとtoolの往復を減らしつつ、Astrolabeが意味的な編集方針まで強制しないためのものです。

旧`syntax_inspect`、`syntax_search`、`syntax_replace`は登録されません。更新後はPiで`/reload`を実行してください。

### フック

- `before_agent_start`: ツール選択前には対応ソースでのAstrolabe優先を短く案内し、選択後は編集意図・既知symbolには`locate`、例外的な調査には`search`/`inspect`を案内します。`locate(mode: "source")`では再inspectせず直接replaceし、複数の同一ファイルcardでsourceが必要なら`inspect_many`を優先します。

Tree-sitterはWASMで動くため、ネイティブアドオンのビルドは不要です。対象はrealpath解決後も作業ディレクトリ内にある既存ファイルだけです。新規ファイルと、作業ディレクトリ外を指すsymlinkは拒否します。

## ハンドルと位置

`web-tree-sitter`にJavaScript文字列を渡す場合、Nodeの公開インデックスと`Point`はこのバインディングのUTF-16文字列位置として扱います。ハンドルには別途UTF-8バイト範囲も保存し、`parser.ts`の変換関数で両者を明示的に変換します。変換はサロゲートペアやUTF-8コードポイントの途中を位置として受け付けません。

改行、CRLF、日本語、絵文字、サロゲートペアを含む位置計算と増分編集には回帰テストがあります。ハンドルには言語IDと文法IDも記録し、異なる言語・文法の構文木では解決しません。ハンドルはファイルごとのLRU（既定256件）で管理するため、inspectを繰り返しても保持数は増え続けません。

## 言語アダプター

Astrolabeはgrammarを再実装しません。言語アダプターが言語ID、文法ID、WASMの場所、拡張子、outline Query、重要ノード種別をまとめて管理します。WASMとParserは文法を初めて使ったときに読み込み、言語IDと文法IDの組ごとに再利用します。同じファイルへの並列初回解析は1個のPromiseを共有します。解析済みファイルのキャッシュもパス、言語ID、文法IDの組で分け、セッション終了時に構文木とParserを解放します。

```text
languages/
└── [language]/
    ├── config.ts
    └── queries.ts
```

outlineは各言語アダプターが定義する宣言・重要ノードに絞り、制御文や式を一覧へ混ぜません。対応言語は`languages/*/config.ts`から起動時に読み込み、各アダプターの拡張子と文法を登録します。TSXとアダプターのない言語は`unsupported_language`で拒否します。拡張子で判定できない単一ファイルは、`astrolabe`の`language`で明示できます。

Queryは`queries.ts`の`String.raw`文字列として管理します。Astrolabe実行時に同じ文字列をTree-sitter Queryとしてコンパイルするため、外部エディタのQuery言語サーバーによる言語判別やparser設定には依存しません。

## 適用範囲

Astrolabeは、対応言語の既存ソースを構文ノード単位で確認・編集するためのツールです。ファイル全体ではなく、関数・型・importなど必要な構造だけを扱えるため、局所的な変更に適しています。

新規ファイル、生成コード、設定ファイル、非対応言語、または構文木操作の効果が薄い変更には通常のファイル生成・read・Diff/patch型編集を使います。複数ファイルにまたがる変更も、各ファイルの局所的な編集へ分解できる場合は対象にできます。

Astrolabeの構文検査は型検査やLintの代替ではありません。編集後は、各言語の型検査・Lint・プロジェクトのテストを別途実行してください。ツール結果の`details.metrics`にはaction別回数、`locate`が返した候補数、要求・応答の概算トークン量を記録します。往復削減の評価はAstrolabe自身のaction metricsまたは外部のベンチマーク解析で行い、汎用session解析側にAstrolabe固有の意味論を要求しません。

## 状態コード

- `stale_node`: continuationの対象を現在のファイルから一意に再同定できないか、ハンドルの言語・文法が現在のアダプターと一致しません。
- `invalid_continuation`: continuationが失効したか変更されています。locate、search、またはoutlineから対象を取り直してください。
- `mixed_paths`: `inspect_many`へ複数ファイルのcontinuationを渡しました。ファイルごとに分けてください。
- `inspect_requires_target` / `source_requires_target`: pathまたはcontinuationなしにinspectしたため、返却された`next`から安全な入力を選べません。
- `syntax_error`: 新しい構文エラー、missing node、または置換後の構文型・親文脈の不一致を検出しました。
- `unsupported_language`: 対象ファイルに言語アダプターがありません。

## Development

```sh
bun run check
```

ツールのschema、説明、promptGuidelines、TUI表示を変更した場合は、Piで`/reload`を実行すると現在のセッションへ反映されます。
