# TASK-31: 今週の稼働棒グラフ（予定 vs 実績）の実装

## 目的

ダッシュボードに曜日別（月〜金）の予定工数 vs 実績工数を比較する棒グラフを追加する。

## 背景

スクリーンショットの「今週の稼働（予定 vs 実績）」グラフは現行データモデルに存在しない。
新たに `weeklyEffort` データ形式を定義し、ダッシュボードへ渡せるようにする。

## データ形式

```js
// dashboard state に追加
weeklyEffort: [
  { day: '月', planned: 8, actual: 8 },
  { day: '火', planned: 8, actual: 9 },
  { day: '水', planned: 8, actual: 7 },
  { day: '木', planned: 8, actual: 10 },
  { day: '金', planned: 8, actual: 5 },
]
```

`weeklyEffort` が未設定の場合はグラフエリアを非表示にする。

## 作業内容（TDD）

### テストを先に書く

- `weeklyEffort` を含む state で `dashboard:init` を送信すると棒グラフ要素（SVG）が描画される
- 各曜日に予定バー（グレー）と実績バー（青）が描画される
- `weeklyEffort` が空/未定義のときグラフエリアが非表示になる

### 実装

- `dashboard.js` の `renderHtml()` に棒グラフ用 `<svg id="weekly-chart">` を追加する。
- `drawWeeklyChart(state)` 関数を実装する（SVG rect で描画）。
- 凡例（予定工数 / 実績工数）を描画する。
- `updateActualEffort` の結果に `weeklyEffort` を含められるよう `presentation/extension.js` を拡張する（将来対応でも可）。

## DoD（完了条件）

- `weeklyEffort` を含む state でグラフが正しく描画される。
- データなし時にグラフエリアが非表示になる。

## 確認チェック

- [ ] `<svg id="weekly-chart">` が HTML に存在する
- [ ] `weeklyEffort` あり時に各曜日のバーが描画される
- [ ] 予定（グレー）と実績（青）が凡例付きで区別できる
- [ ] `weeklyEffort` なし時にグラフエリアが非表示になる
- [ ] 既存テストがすべて通過する
