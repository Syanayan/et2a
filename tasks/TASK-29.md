# TASK-29: 祝日同期に実ローダーを注入して動作させる

## 目的

実機 VS Code で `Kousu: Sync Holidays` を実行しても祝日が同期されない問題を修正する。

## 背景

`syncHolidaysUsecase` は `syncHolidays`（`holidaySyncService`）を呼ぶが、
`loaders`（HTTP/ファイル読み込み実装）が渡されていない。
`resolveLoader` が `loaders` を受け取らないため、ソースが設定されていても
`unsupported_source_type` エラーが発生し、既存の休日リストへのフォールバックで終わる。

加えて `vscodeMain.js` 側でも実ローダーが注入されていない。

## 作業内容

### 1. `syncHolidaysUsecase` に `loaders` を通す

`syncHolidaysUsecase` のパラメータに `loaders` を追加し、
内部の `syncHolidays()` 呼び出しへ渡す。

```js
// syncHolidays.js
const { ..., loaders } = params;
const result = await syncHolidays({ sources, currentHolidays, loaders });
```

### 2. `vscodeMain.js` で実ローダーを実装・注入する

`presentation/extension.js` の `syncHolidays` コマンドに `loaders` を渡せるよう、
`vscodeMain.js` 側で HTTP（`api` 型）・ファイル（`file` 型）・CSV（`csv` 型）の
最低限のローダーを実装して注入する。

### 3. `holidaySources` が空の場合のメッセージ改善（任意）

`holidaySources` が空の状態で同期を実行したとき、現状は通知なしで終わる。
「同期ソースが設定されていません」等のメッセージを表示するとUXが改善する。

## DoD（完了条件）

- `holidaySources` に有効なソースが設定されている場合、実機で祝日が取得・保存される。
- `holidaySources` が空の場合はその旨を通知する。

## 確認チェック

- [ ] `syncHolidaysUsecase` が `loaders` パラメータを受け取り `syncHolidays` に渡す
- [ ] `vscodeMain.js` に `api` / `file` 型の実ローダーが実装されている
- [ ] `holidaySources` が空のとき「ソース未設定」の通知が出る
- [ ] 既存テストがすべて通過する
