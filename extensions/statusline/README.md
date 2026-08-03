# statusline

`ctx.ui.setStatus()` で公開された拡張機能のステータスを残したまま、モデル・思考レベル・コンテキスト・Git ブランチをコンパクトに表示する Powerline 風フッターです。

ステータスメッセージは `footerData.getExtensionStatuses()` から読み、幅が足りないときはセグメント単位で次の行へ送ります。表示できないステータスを優先度で黙って落とすことはありません。

## 競合

Pi のフッターを置き換える拡張機能は同時に一つしか使えません。既存の `pi-statusline` などを有効にしている場合は、先にその拡張機能を無効化してください（多くの場合は `/statusline off`）。

```sh
bun run --cwd extensions/statusline check
bun run --cwd extensions/statusline dev
```
