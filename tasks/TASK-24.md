# TASK-24: workingDayContext を初期プロジェクトロード後に正しく伝播させる

## 目的

`vscodeMain.js` で起動時に計算した `elapsed`/`remaining` が使われず、`updateActual` コマンドの進捗計算が常にゼロになる問題を修正する。

## 背景

`vscodeMain.js:49-52` で `elapsed`/`remaining` を算出しているが、`_activate` へ渡す `workingDayContext` は `{ elapsedWorkingDays: 0, totalWorkingDays: 0, remainingWorkingDays: 0 }` の初期値のまま更新されていない。

## 作業内容

- `vscodeMain.js` で initialProject のロード後に `workingDayContext` を算出し、`result.setProjects` へ渡す。
- `presentation/extension.js` の `setProjects` が `workingDayContext` を受け取り、コマンドハンドラが参照するクロージャ変数を更新できるよう拡張する。

## DoD（完了条件）

- 起動後に `kousu.updateActual` を実行すると、正しい `elapsedWorkingDays`/`remainingWorkingDays` で予測が計算される。

## 確認チェック

- [ ] `vscodeMain.js` が initialProject から `elapsed`/`remaining` を計算して伝播している
- [ ] `presentation/extension.js` の `setProjects` が workingDayContext を受け取れる
- [ ] `updateActual` 実行時の forecast 計算にゼロでない working day が使われる
- [ ] 既存テストがすべて通過する
