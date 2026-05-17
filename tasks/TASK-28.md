# TASK-28: サイドバー TreeItem を VS Code API 準拠に修正する

## 目的

実機 VS Code でサイドバー（Project Status ビュー）のアイテムが表示されない問題を修正する。

## 背景

`KousuSidebarProvider.getChildren()` がプレーンオブジェクト `{ label: '...' }` を返し、
`getTreeItem()` がそのままそれを返している。VS Code の TreeView は `collapsibleState` などの
フィールドを必要とするため、プレーンオブジェクトではアイテムが正しく描画されない。

## 作業内容

- `sidebar.js` の `getChildren()` が返す各要素に `collapsibleState: 0`（None）を追加する。
- または `getTreeItem()` 内で VS Code の `TreeItem` 相当のオブジェクトに変換する。
- `vscode` モジュールへの依存を避けるため、`collapsibleState: 0` をプレーンオブジェクトで
  付与する方針とする（`new vscode.TreeItem(...)` は使わない）。

## DoD（完了条件）

- 実機 VS Code でサイドバーに Project / Progress / Remaining / Alert の4アイテムが表示される。

## 確認チェック

- [x] `getChildren()` の各要素に `collapsibleState: 0` が含まれる
- [ ] 実機でサイドバーアイテムが4件表示される
- [x] 既存テストがすべて通過する
