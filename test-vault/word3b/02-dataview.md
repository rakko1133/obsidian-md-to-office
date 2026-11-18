---
status: sample
---
# Dataview

このサンプルは、テスト用 Vault に Dataview プラグインを入れて有効にしてから変換する。Dataview がなければ、コードのまま残って警告が出る。

## TABLE

```dataview
TABLE status, length(file.outlinks) AS "リンク数"
FROM "word3b/data"
SORT file.name ASC
```

## LIST

```dataview
LIST
FROM "word3b/data"
SORT file.name ASC
```

## TASK

```dataview
TASK
FROM "word3b/data"
```

## dataviewjs

```dataviewjs
dv.header(3, "dataviewjs の見出し");
dv.paragraph("dataviewjs で書いた段落。**太字**も入る。");
dv.table(["名前", "値"], [["a", 1], ["b", 2]]);
```

## インラインのクエリ（3b では対象外。文字のまま）

`= this.status`
