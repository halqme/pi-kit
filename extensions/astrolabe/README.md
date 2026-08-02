# Astrolabe

Astrolabeは、対応言語の既存ファイルを構文単位で検索・読取り・局所編集するTree-sitter拡張です。公開APIは単一の`astrolabe` toolであり、読取り時の構造確認はサーバー側で完結します。

## `astrolabe` tool

`action`で`search`、`inspect`、`replace`、`replace_many`を選びます。

- `search`は`scope`に既存の対応ソースファイルまたはディレクトリを渡し、関数・呼出し・importを検索します。ディレクトリは対応する通常ファイルだけを再帰検索し、symlinkは辿りません。
- `inspect`は`path`でoutlineを取得するか、前回返された`continuation`で最小のsourceを取得します。outline→structure→sourceの手動遷移やnodeIdの抽出は不要です。
- `replace`は有効な`continuation`と完全な`replacement`を受け、現在のsource hash、ノード型・範囲・親文脈を再検証してから保存します。source取得を別途行う必要はありません。増分再解析、構文エラー、原子的保存の検証は維持します。
- `replace_many`は同一ファイル内の複数continuationを全件検証し、置換後の構文検査に成功した場合だけatomicに保存します。1件でもstale、範囲重複、構文エラーがあればファイルを変更しません。

操作結果は`content`のJSONとして返し、`details`にはmetricsなどの内部診断情報だけを含めます。continuationは短命かつセッション限定で、失効・別path・stale・source未確認の状態では書込みません。

```json
{ "action": "search", "scope": "packages/session-metrics/src", "kind": "call", "name": "exists" }
```

`inspect`や`search`の結果には、後続操作に使えるcontinuationが含まれます。複数箇所を変更する場合は、同一ファイルのcontinuationとreplacementを`replace_many`にまとめます。失敗時には、再検査などの回復に使える情報を返します。

旧`syntax_inspect`、`syntax_search`、`syntax_replace`は登録されません。更新後はPiで`/reload`を実行してください。

### フック

- `before_agent_start`: ツール選択前には対応ソースでのAstrolabe優先を短く案内し、選択後はscope検索とcontinuation再利用を案内します。未対応・生成物・設定・新規ファイルは通常のツールを使います。

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

Astrolabeの構文検査は型検査やLintの代替ではありません。編集後は、各言語の型検査・Lint・プロジェクトのテストを別途実行してください。

## 状態コード

- `stale_node`: 検査済みノードを現在のファイルから一意に再同定できないか、ハンドルの言語・文法が現在のアダプターと一致しません。
- `invalid_continuation`: continuationが失効したか、変更されています。searchまたはoutlineからやり直してください。
- `inspect_requires_target` / `source_requires_target`: pathまたはcontinuationなしにinspectしたため、返却された`next`から安全な入力を選べません。
- `syntax_error`: 新しい構文エラー、missing node、または置換後の構文型・親文脈の不一致を検出しました。
- `unsupported_language`: 対象ファイルに言語アダプターがありません。

## Development

```sh
bun run check
```

ツールのschema、説明、promptGuidelines、TUI表示を変更した場合は、Piで`/reload`を実行すると現在のセッションへ反映されます。
