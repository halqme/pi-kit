# Astrolabe session benchmark

実際のリポジトリ内TypeScriptファイルを一時ディレクトリへコピーし、同じ編集タスクをfreshなPiプロセスで実行します。Astrolabeを明示的に読み込む場合と、通常の`read`/`edit`だけを使う場合を比較します。Astrolabe自身のソースは比較対象から除外し、`extensions/grill-plan/index.ts`、`extensions/agent-team/index.ts`、`extensions/agent-team/team.ts`、`packages/session-metrics/src/report.ts`を使います。

fixtureは実ファイルの内容とサイズをそのまま使い、対象文字列が一意に存在することを実行前に検証します。これにより、虚構のファイル構造ではなく、実際のTypeScriptコード上でファイルサイズ・対象位置・探索コストを比較します。

## 実行

APIキー・モデル設定済みの環境で、モデルを指定して実行します。

```sh
bun run benchmark:astrolabe --model <provider/model>
```

反復回数とタスクを限定できます。

```sh
bun run benchmark:astrolabe --model <provider/model> --repetitions 3
bun run benchmark:astrolabe --model <provider/model> --task typescript-multiple-edit
```

`PI_BIN`でPi実行ファイルを変更できます。各試行は`--no-session`で起動し、終了後に一時ディレクトリを削除します。

## 記録内容

JSONを標準出力へ出力します。各結果には次を含みます。

- 実際のtool call数と失敗tool call数
- Astrolabe、および通常の`read`/`edit`の呼出し数
- tool引数・結果の文字数と4文字あたり1tokenの概算
- 実編集結果がfixtureの期待値と一致したか
- 実行時間
- fixtureの文字数・行数

これはモデルを含む統合ベンチマークです。モデルのランダム性、プロバイダーの遅延、既存のPi設定の影響を受けるため、単一実行の時間だけで判断せず、同じ条件の反復結果と編集成功率を比較してください。
