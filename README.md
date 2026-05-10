# et2a
工数管理

## レイヤ構成

- `src/presentation`: VS Code UI と表示制御
- `src/application`: ユースケース
- `src/domain`: 計算・判定ロジック
- `src/infrastructure`: ファイル/HTTP など外部I/O

## 依存ルール

- `presentation` 層は `application` 層のみを参照する。
- `presentation` 層から `domain` / `infrastructure` への直接参照は禁止。
- `application` 層は `domain` と `infrastructure` を組み合わせて利用する。
