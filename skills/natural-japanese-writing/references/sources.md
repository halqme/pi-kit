# 設計根拠と参考資料

最終確認日: 2026-07-29

この Skill は、以下の資料を踏まえて設計している。資料の主張をそのまま規則化するのではなく、日本語生成で観察される失敗へ適用できる形に整理した。

## Skill の構成

### OpenAI, “Build skills”

https://developers.openai.com/codex/build-skills

Skill は `SKILL.md` を必須とし、必要に応じて `references/`、`scripts/`、`assets/` を含められる。モデルは最初に name と description を見て、必要と判断したときに本文を読む。そのため、本 Skill では description に適用対象と非適用条件を明記し、詳細資料を references に分離した。

### OpenAI, “Skills”

https://developers.openai.com/api/docs/guides/tools-skills

Skill は front matter と指示を含む `SKILL.md` を中心とした、再利用可能なファイル群として扱われる。配布用 ZIP は一つのトップレベルフォルダを持つ構成にした。

## 指示と評価の設計

### OpenAI, “Prompt engineering”

https://developers.openai.com/api/docs/guides/prompt-engineering

モデル出力には揺れがあり、モデル更新でも挙動が変わりうるため、指示だけでなく評価セットを用意することが推奨されている。本 Skill では、規則本体とは別に回帰評価の手順を置いた。

### OpenAI, “Testing Agent Skills Systematically with Evals”

https://developers.openai.com/blog/eval-skills

Skill の評価では、結果、手順、文体、効率などの目標を分け、必須項目を少数に絞ることが推奨されている。本 Skill のチェックリストは、意味保持、用語、自然さ、明確さ、文体適合を分離している。

### OpenAI, “Building resilient prompts using an evaluation flywheel”

https://developers.openai.com/cookbook/examples/evaluation/building_resilient_prompts_using_an_evaluation_flywheel

失敗例を観察して分類し、測定し、対象を絞って改善する反復手順を参考にした。禁止語を思いつくたびに追加するのではなく、失敗類型と評価例を蓄積する設計にしている。

## 多言語 LLM と翻訳調

### Guo et al. (2024), “Do Large Language Models Have an English ‘Accent’?”

https://arxiv.org/abs/2410.15956

英語中心の多言語 LLM が、非英語出力で語彙・構文上の英語的傾向を示す問題を扱う。対象言語は主にフランス語と中国語であり、日本語への直接的な実証ではない。ただし、「文法的に正しいこと」と「母語話者の文章として自然であること」を分けて評価する根拠になる。

### Gao and Das (2024), “Customizing Language Model Responses with Contrastive In-Context Learning”

https://arxiv.org/abs/2401.17390

好ましい例と避けたい例を対照させることで、説明しにくい文体上の意図を伝える方法を提案している。本 Skill では、単なる禁止事項ではなく「悪い例・良い例・理由」を併記した。

## 日本語の表記・翻訳品質

### 日本翻訳連盟, 「JTF日本語標準スタイルガイド（翻訳用）」

https://www.jtf.jp/tips/styleguide

和訳時の日本語表記を統一するための資料である。本 Skill では表記統一そのものを扱うのではなく、必要に応じて参照できる外部基準として位置付ける。表記規則だけでは、直訳語、共起、概念の混同、談話構成までは十分に扱えないためである。

### 日本翻訳連盟, 「JTF翻訳品質評価ガイドライン」

https://www.jtf.jp/tips/translation_quality_guidelines

翻訳品質について関係者間の共通認識を作り、用途に応じて評価するための資料である。本 Skill では、自然さだけを単独で最適化せず、正確さ、用語、文体を別軸にする考え方の参考にした。

## 適用上の注意

- 多言語 LLM の研究結果を、日本語にそのまま一般化できるとは限らない。
- JTF のスタイルガイドは主に表記の統一を扱うため、日本語の自然さを全面的に保証する資料ではない。
- 対照例の効果はモデル、タスク、例の選び方に依存する。
- Skill の効果は、利用するモデルと実際の入力を使って継続的に評価する必要がある。
