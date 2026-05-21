# TASK-33: タイムシートファイルから実績工数を同期する

## 目的

CSV または JSON で出力したタイムシートを読み込み、メンバー合計をプロジェクトの
`effort.actual` に反映してダッシュボードを更新する。

## データ形式

**CSV**（ヘッダーなし、name, hours）
```csv
Alice,8.0
Bob,6.5
Carol,7.0
```

**JSON**
```json
[
  { "name": "Alice", "hours": 8.0 },
  { "name": "Bob",   "hours": 6.5 }
]
```

値は**プロジェクト開始からの累計工数**。全メンバーの `hours` を合計して `effort.actual` に設定する。

## kousu.config.json への追加

```json
"timesheetSource": { "type": "csv", "path": "timesheet.csv" }
```

`type` は `"csv"` または `"json"`。`path` はワークスペースからの相対パスまたは絶対パス。

## 作業内容（TDD）

1. `test/syncTimesheet.test.js` にテストを書く
2. `src/application/usecases/syncTimesheet.js` を実装する
3. `presentation/extension.js` に `kousu.syncTimesheet` コマンドを追加する
4. `package.json` の `contributes.commands` に追加する

## DoD（完了条件）

- CSV / JSON を読み込んでメンバー合計が `effort.actual` に反映される
- `timesheetSource` 未設定時は警告を出して終了する
- 保存後にバーンダウン・今週グラフが更新される

## 確認チェック

- [ ] CSV を読み込んで合計が `effort.actual` に設定される
- [ ] JSON を読み込んで合計が `effort.actual` に設定される
- [ ] `timesheetSource` 未設定時に警告通知が出る
- [ ] 同期後に `burndown` と `weeklyEffort` がダッシュボードに渡される
- [ ] 既存テストがすべて通過する
