# PDF の読みやすさ

本文は和文と English が混ざる段落です。英数字（ABC 123）と和文の見た目がそろっているかを確かめます。長い段落は印字領域の幅で折り返します。

## 列の多い表

| 名前 | 整数 | 桁区切り | 小数 | 負の数 | 率 | 円 | ドル | 円（後ろ） | 日付 | 日時 | 真偽 | メモ |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|---|---|---|
| りんご | 1 | 1,200 | 0.5 | -3 | 12% | ¥1,200 | $3.50 | 980円 | 2026-11-18 | 2026-11-18 10:30 | TRUE | 長いメモの文章がここに入ります |
| みかん | 20 | 34,500 | 1.25 | -0.5 | 7.5% | ¥80 | $12.00 | 1,500円 | 2026-11-19 | 2026-11-19 09:00 | FALSE | https://example.com/a/very/long/url/that/does/not/break |

## 長い行のコード

```text
これはとても長い行です。これはとても長い行です。これはとても長い行です。これはとても長い行です。これはとても長い行です。
```

```js
const veryLongVariableName = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour, five);
```

インラインのコード `aVeryLongInlineCodeIdentifierThatShouldWrapInsideTheParagraphInsteadOfOverflowing` も折り返します。
