# TASK-34: タイムシートのメンバー別月次テーブルを表示する

## 目的

月ごと×メンバー別の工数内訳をダッシュボードにテーブル表示する。

## 新しいファイル形式

**CSV**（name, month, hours の3列、名前でソート済み）
```csv
Alice,2026-04,40.0
Alice,2026-05,20.0
Bob,2026-04,32.0
```

**JSON**
```json
[
  { "name": "Alice", "months": { "2026-04": 40.0, "2026-05": 20.0 } },
  { "name": "Bob",   "months": { "2026-04": 32.0 } }
]
```

## 表示イメージ

| 月 | Alice | Bob | 合計 |
|---|---|---|---|
| 2026-04 | 40h | 32h | 72h |
| 2026-05 | 20h | - | 20h |

## 作業内容（TDD）

1. `syncTimesheet.js` を更新し、3列CSV・ネストJSON を解析して `monthlyBreakdown` を返す
2. `dashboard.js` に月次テーブルセクションを追加する
3. `extension.js` の `syncTimesheet` コマンドで `monthlyBreakdown` をダッシュボードに渡す

## monthlyBreakdown の型

```js
{
  members: ['Alice', 'Bob'],          // ソート済み
  months:  ['2026-04', '2026-05'],    // ソート済み
  data: {
    '2026-04': { Alice: 40.0, Bob: 32.0 },
    '2026-05': { Alice: 20.0 }
  }
}
```

## DoD（完了条件）

- CSV / JSON を読み込んで `monthlyBreakdown` が正しく生成される
- `effort.actual` は全月・全メンバーの合計になる
- ダッシュボードに月次テーブルが表示される（データなし時は非表示）

## 確認チェック

- [x] CSV（3列）を解析して `monthlyBreakdown` が生成される
- [x] JSON（ネスト形式）を解析して `monthlyBreakdown` が生成される
- [x] `effort.actual` が全月合計になる
- [x] ダッシュボードに `id="monthly-table"` が存在する
- [x] データなし時にテーブルが非表示になる
- [x] 既存テストがすべて通過する
