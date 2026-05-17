# TASK-26: activate の戻り値に close メソッドを追加して VS Code の subscription cleanup を機能させる

## 目的

`vscodeMain.js:61` で `result.close?.()` を呼んでいるが、`presentation/extension.js` の `activate` 戻り値に `close` が存在しないため、拡張機能の deactivate 時に cleanup が実行されない。

## 背景

VS Code は `context.subscriptions.push(disposable)` に登録された disposable の `dispose()` を deactivate 時に呼ぶ。現状は `result.close` が undefined のためサイレントに無視され、登録コマンドや TreeView のリソース解放が行われない。

## 作業内容

- `presentation/extension.js` の `activate` 戻り値に `close()` メソッドを追加する。
- `close()` 内でダッシュボードパネルの dispose・サイドバープロバイダのリスナー解除など、保持リソースの解放処理を行う。
- `vscodeMain.js` の `context.subscriptions.push({ dispose: () => result.close?.() })` がそのまま機能することを確認する。

## DoD（完了条件）

- VS Code の拡張機能停止時（デバッグ終了・リロード）に `close` が呼ばれ、リソースリークが発生しない。

## 確認チェック

- [x] `activate` の戻り値に `close` メソッドが存在する
- [x] `close()` 呼び出しでダッシュボードパネルが dispose される
- [x] `close()` 呼び出しでサイドバープロバイダのリスナーが解除される
- [x] 既存テストがすべて通過する
