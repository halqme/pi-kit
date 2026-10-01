# 設計根拠と参考資料

最終確認日: 2026-10-01

このSkillは、日本語の自然さを固定的な禁止語や文長規則へ還元せず、意味保持、意味関係の復元可能性、文脈適合、書き手の声の保持を分けて扱う。

参考資料から個別の表現規則をそのままコピーしない。観察された失敗傾向は、runtimeの禁止事項ではなく、評価ケースや診断観点として使う。

## Skillの構成と評価

### OpenAI, “Build skills”

https://developers.openai.com/codex/build-skills

Skillは `SKILL.md` を中心に、必要に応じて `references/` や評価資料を持てる。本Skillではruntimeの判断原理を `SKILL.md` に置き、失敗類型と対照例は `evals/` に分離する。

### OpenAI, “Skills”

https://developers.openai.com/api/docs/guides/tools-skills

再利用可能なSkillを、front matterと実行時指示を中心に構成する考え方を参照している。

### OpenAI, “Prompt engineering”

https://developers.openai.com/api/docs/guides/prompt-engineering

モデル出力には揺れがあり、モデル更新でも挙動が変わる。固定規則を増やす代わりに、代表的な失敗と過剰修正をevalとして保持する。

### OpenAI, “Testing Agent Skills Systematically with Evals”

https://developers.openai.com/blog/eval-skills

意味保持、専門用語、文脈適合、声の保持、過剰修正の回避を分けて評価する設計の参考にした。

## 多言語LLMと翻訳調

### Guo et al. (2024), “Do Large Language Models Have an English ‘Accent’?”

https://arxiv.org/abs/2410.15956

英語中心の多言語LLMが、非英語出力で英語的な語彙・構文傾向を示す問題を扱う。主な対象言語は日本語ではないため、日本語への直接的な実証とはみなさない。

本Skillでは、「文法的に成立すること」と「その媒体や分野の日本語として自然に読めること」を分ける根拠として参照する。

### Gao and Das (2024), “Customizing Language Model Responses with Contrastive In-Context Learning”

https://arxiv.org/abs/2401.17390

好ましい例と避けたい例の対照から、説明しにくい文体上の差を伝える方法を扱う。

本Skillでは対照例を普遍的なgood/bad規則にはせず、`evals/contrastive-examples.md` の開発資料として扱う。

## 日本語の表記と翻訳品質

### 日本翻訳連盟, 「JTF日本語標準スタイルガイド（翻訳用）」

https://www.jtf.jp/tips/styleguide

和訳時の表記統一に使える外部基準。表記統一自体を本Skillの標準動作にはせず、ユーザーや文書が明示的に特定の表記規則を求める場合に使う。

### 日本翻訳連盟, 「JTF翻訳品質評価ガイドライン」

https://www.jtf.jp/tips/translation_quality_guidelines

翻訳品質を単一の「自然さ」だけで評価せず、正確さ、用語、用途への適合などを分けて扱う考え方の参考にした。

## 意味構造とAI生成文の編集に関する比較資料

### nanaism/yomiyasu

https://github.com/nanaism/yomiyasu

AI生成日本語について、主述関係、非生物主語、抽象的な動詞、名詞化、指示語、装飾などを具体的に診断するSkill。問題を表層語の置換だけでなく文の構造として扱う点を比較対象にした。

本Skillは、そこで示される個別の禁止・置換規則を採用しない。受動態、無生物主語、比喩、記号などは文脈上自然な場合があるため、意味関係が隠れているかどうかを上位の判断基準にする。

### Zenn, 「AIが生成する『不自然な日本語』をどう直すか」に関する解説

https://zenn.dev/algoartis/articles/0b1c731881b25c

単語レベルの置換だけでは、不自然な抽象表現を別の抽象表現へ移すだけになるという問題意識を参考にした。

本Skillではこの着想を一般化し、述語が表す動作・状態・失敗モード、照応、因果、限定を読み手が復元できるかを確認する。具体化に必要な情報が入力にない場合は、もっともらしい内容を補わない。

## このSkillが採用しない設計

次の方針は、評価上のヒントにはなってもruntimeの普遍規則にはしない。

- 文長や読点数の固定閾値
- 特定の比喩動詞のブラックリスト
- 無生物主語や受動態の一律排除
- 太字、箇条書き、括弧、ダッシュ、絵文字の一律排除
- 同一文末の機械的な回避
- 「AIらしい」という理由だけの語彙置換

これらは媒体、分野、書き手によって自然にも不自然にもなり得る。問題がある場合は、その表現が隠している意味関係や、その文脈で果たせていない機能を理由に修正する。

## 適用上の注意

- 多言語LLMの研究結果を日本語へそのまま一般化しない。
- 表記ガイドは自然さ全体を保証しない。
- 対照例は唯一の正解ではない。
- 失敗類型は診断用であり、禁止語リストではない。
- Skillの効果は、利用するモデルと実際の入力を使って継続的に評価する。
