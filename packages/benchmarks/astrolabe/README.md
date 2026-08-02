# Astrolabe session benchmark

各言語のfixtureを一時ディレクトリへ展開し、同じ編集タスクをfreshなPiプロセスで実行します。Astrolabeを明示的に読み込む場合と、通常の`read`/`edit`だけを使う場合を比較します。

対応言語のディレクトリは`extensions/astrolabe/languages/*`から検出されます。言語を追加したときは、このベンチマークにも同じ言語のfixtureを追加してください。fixtureがない言語があると実行を中止します。

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

これはモデルを含む統合ベンチマークです。モデルのランダム性、プロバイダーの遅延、既存のPi設定の影響を受けるため、単一実行の時間だけで判断せず、同じ条件の反復結果と編集成功率を比較してください。
