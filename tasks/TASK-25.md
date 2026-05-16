# TASK-25: プロジェクトロード時にダッシュボードへ初期データを送信する

## 目的

起動時にプロジェクトが読み込まれた後、ダッシュボードを開いても KPI が全て `-` のままになる問題を解消する。

## 背景

`vscodeMain.js` で `result.setProjects` を呼んでサイドバーは更新されるが、ダッシュボードへの初期データ送信がない。`updateActual` を一度実行するまで KPI・バーンダウンが描画されない。

## 作業内容

- `presentation/extension.js` の `setProjects` 内で、activeProject が確定した後に `dashboard.update({ project: activeProject })` を呼ぶ。
- または `vscodeMain.js` 側で `result.updateDashboard(...)` を呼ぶ形にする（どちらが責務として適切か判断して実装する）。

## DoD（完了条件）

- 起動直後にダッシュボードを開くと、読み込み済みプロジェクトの設定値（総工数・実績・残工数）が表示される。

## 確認チェック

- [ ] `setProjects` 後にダッシュボードへ `dashboard:update` が送信される
- [ ] ダッシュボードを開くと KPI カードに初期値が表示される
- [ ] プロジェクト未選択時はダッシュボードを開いても `-` のまま（クラッシュしない）
- [ ] 既存テストがすべて通過する
