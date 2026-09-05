# 設計根拠と参考資料

最終確認日: 2026-09-05

この Skill は、以下の資料を踏まえて設計している。資料の主張をそのまま文章規則へ変換するのではなく、用途・読者・媒体・分野・周辺文脈に応じて日本語を判断するための設計根拠として使う。

固定的な禁止語、構文チェックリスト、表記規則を runtime の中心には置かない。失敗類型や対照例は `evals/` に分離し、Skill が一般的な「良い日本語」へ過剰に正規化されていないかを回帰評価するために使う。

## Skill の構成

### OpenAI, “Build skills”

https://developers.openai.com/codex/build-skills

Skill は `SKILL.md` を必須とし、必要に応じて `references/`、`scripts/`、`assets/` を含められる。モデルは最初に name と description を見て、必要と判断したときに本文を読む。そのため、本 Skill では description に適用対象と非適用条件を明記し、runtime の中心となる判断原則は `SKILL.md` に限定している。

### OpenAI, “Skills”

https://developers.openai.com/api/docs/guides/tools-skills

Skill は front matter と指示を含む `SKILL.md` を中心とした、再利用可能なファイル群として扱われる。本 Skill では、実行時の指示と開発時の評価資料を分離する。

## 指示と評価の設計

### OpenAI, “Prompt engineering”

https://developers.openai.com/api/docs/guides/prompt-engineering

モデル出力には揺れがあり、モデル更新でも挙動が変わりうるため、指示だけでなく評価セットを用意することが推奨されている。本 Skill では、固定的な文章規則を増やす代わりに `evals/evals.json` で代表的な失敗と過剰修正を評価する。

### OpenAI, “Testing Agent Skills Systematically with Evals”

https://developers.openai.com/blog/eval-skills

Skill の評価では、結果、手順、文体、効率などの目標を分け、必須項目を少数に絞ることが推奨されている。本 Skill では、意味保持、専門用語、文脈適合、既存の声の保持、過剰修正の回避を個別の assertion として評価する。

### OpenAI, “Building resilient prompts using an evaluation flywheel”

https://developers.openai.com/cookbook/examples/evaluation/building_resilient_prompts_using_an_evaluation_flywheel

失敗例を観察して分類し、測定し、対象を絞って改善する反復手順を参考にした。新しい失敗を見つけるたびに禁止語や runtime 規則を追加するのではなく、まず eval case として再現し、Skill 本体を変える必要があるかを判断する。

## 多言語 LLM と翻訳調

### Guo et al. (2024), “Do Large Language Models Have an English ‘Accent’?”

https://arxiv.org/abs/2410.15956

英語中心の多言語 LLM が、非英語出力で語彙・構文上の英語的傾向を示す問題を扱う。対象言語は主にフランス語と中国語であり、日本語への直接的な実証ではない。ただし、「文法的に正しいこと」と「その文脈で母語話者の文章として自然であること」を分けて評価する根拠になる。

### Gao and Das (2024), “Customizing Language Model Responses with Contrastive In-Context Learning”

https://arxiv.org/abs/2401.17390

好ましい例と避けたい例を対照させることで、説明しにくい文体上の意図を伝える方法を提案している。本 Skill では、対照例を runtime の普遍的な good/bad 例として固定せず、`evals/contrastive-examples.md` に開発資料として置く。日本語の文体選好は文脈依存であり、同じ表現でも媒体や分野によって評価が変わるためである。

## 日本語の表記・翻訳品質

### 日本翻訳連盟, 「JTF日本語標準スタイルガイド（翻訳用）」

https://www.jtf.jp/tips/styleguide

和訳時の日本語表記を統一するための資料である。本 Skill では表記統一そのものを標準動作にはせず、ユーザーや文書が特定の表記規則を求める場合の外部基準として位置付ける。表記規則だけでは、直訳語、共起、概念の混同、談話構成、媒体ごとの文体差までは扱えないためである。

### 日本翻訳連盟, 「JTF翻訳品質評価ガイドライン」

https://www.jtf.jp/tips/translation_quality_guidelines

翻訳品質について関係者間の共通認識を作り、用途に応じて評価するための資料である。本 Skill では、自然さだけを単独で最適化せず、正確さ、用語、用途への適合を分けて扱う考え方の参考にした。

## 適用上の注意

- 多言語 LLM の研究結果を、日本語にそのまま一般化できるとは限らない。
- JTF のスタイルガイドは主に表記の統一を扱うため、日本語の自然さを全面的に保証する資料ではない。
- 対照例の効果はモデル、タスク、例の選び方に依存する。
- `evals/` の失敗類型や改善例は普遍的な文章規則ではない。各ケースの文脈と失敗理由を評価する。
- Skill の効果は、利用するモデルと実際の入力を使って継続的に評価する必要がある。
