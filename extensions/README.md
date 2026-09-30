# Extensions

Pi Kitのextensionは、モデルに見せる境界を少なく保ちます。

中核:

- `repository` — `context`、`code`、`read`、`edit`。概念検索、構造検索、inspection、validated mutationと、現在の内容に基づく復旧誘導を同一repository engine上で扱う。
- `task` — `task` と `verify`。適応的task stateと実行済みverification evidenceを管理する。
- `delegate` — child Piを専用Git worktree/branchへ隔離して実行する。

汎用utility:

- `ask` — TUIの対話を使うmodel-only tool。Codemodeからは呼び出せない。
- `background_process`
- `terminal`

Pi 0.99以降では、使用場面が限られる次のツールをdeferred exposureにしている。Piの`tool_search`を使うと必要なツールを検索できるが、これは既定で無効である。利用するには、Piのユーザー設定（`~/.pi/agent/settings.json`）かプロジェクト設定（`.pi/settings.json`）の`defaultTools`に`"+tool_search"`を追加する。次の設定例では、Piの既定ツールを維持したまま`tool_search`を有効にできる。

```json
{
  "defaultTools": ["+tool_search"]
}
```

Pi KitはPiの設定を自動変更しない。

- `browser_inspector`
- `macos_talk` — AppleScript/JXAを`osascript`へ直接渡すmacOS automation boundary。foregroundを必要以上に奪わないscriptを優先する。
- `session_metrics`
- `semantic_observe` — task/runtime evidenceに対する実験的なJev観測。結果はadvisoryに限定する。
