# 工数管理 VS Code 拡張 詳細設計書

## 1. 目的・前提
本書は `docs/specification/basic_design.md` を実装可能な粒度へ具体化し、モジュール責務、I/F、データ構造、処理シーケンス、エラー処理、テスト仕様を定義する。

- 対象: VS Code 拡張本体（Extension Host / Domain / Infrastructure / Presentation）
- 非対象: 外部SaaS常駐サーバー、クラウド配備
- 実装想定: TypeScript + VS Code Extension API

---

## 2. ディレクトリ/モジュール設計

## 2.1 推奨ディレクトリ構成

```text
src/
  extension.ts
  application/
    usecases/
      initializeProject.ts
      loadActiveProject.ts
      updateActualEffort.ts
      syncHolidays.ts
      recalculateForecast.ts
    services/
      projectResolver.ts
      configValidationService.ts
  domain/
    model/
      projectConfig.ts
      forecastResult.ts
      alertState.ts
    services/
      workingDayCalculator.ts
      forecastCalculator.ts
      alertEvaluator.ts
  infrastructure/
    config/
      configRepository.ts
      configBackupRepository.ts
      schemaValidator.ts
      migrator.ts
    holiday/
      holidaySyncService.ts
      holidaySourceFile.ts
      holidaySourceApi.ts
      holidaySourceCsv.ts
    api/
      localApiServer.ts
      authTokenProvider.ts
      rateLimiter.ts
    log/
      auditLogger.ts
  presentation/
    commands/
      registerCommands.ts
    tree/
      sidebarProvider.ts
      viewModelMapper.ts
    webview/
      dashboardProvider.ts
      dashboardState.ts
      assets/
```

## 2.2 レイヤ依存ルール

- `presentation` は `application` のみ参照可。
- `application` は `domain` + `infrastructure` を利用しユースケースを構成。
- `domain` は純粋関数中心（VS Code API / fs 直接依存禁止）。
- `infrastructure` は外部I/O責務を集約。

---

## 3. 詳細データ設計

## 3.1 型定義（抜粋）

```ts
export type DateYmd = `${number}-${number}-${number}`;

export interface ProjectConfig {
  schemaVersion: string;
  projectId: string;
  projectName: string;
  schedule: ScheduleConfig;
  effort: EffortConfig;
  members: MemberConfig[];
  integration: IntegrationConfig;
}

export interface IntegrationConfig {
  api: LocalApiConfig;
}

export interface LocalApiConfig {
  enabled: boolean;
  bind: "127.0.0.1";
  port: number;
  tokenEnv: "KOUSU_API_TOKEN";
  startupMode?: "manual" | "auto";
}

export interface ScheduleConfig {
  startDate: DateYmd;
  endDate: DateYmd;
  holidays: DateYmd[];
  holidaySources?: {
    company?: HolidaySource;
    member?: HolidaySource;
  };
}

export interface EffortConfig {
  total: number;
  buffer: number;
  bufferMode: "inclusive" | "exclusive";
  actual: number;
  unit: "person_day";
}

export interface MemberConfig {
  name: string;
  dailyEffort: number; // 0.1 - 1.5
  personalHolidays: DateYmd[];
}

export interface ForecastResult {
  status: "ok" | "insufficient_data" | "period_closed" | "fallback_weekend_only";
  averageVelocity?: number;
  elapsedWorkingDays: number;
  totalWorkingDays: number;
  remainingWorkingDays: number;
  predictedTotalEffort?: number;
  depletionDate?: DateYmd;
  remainingEffort: number;
  exceededEffort: number;
  warningMessages: string[];
}
```

## 3.2 バリデーションルール

- `schedule.startDate <= schedule.endDate`
- `effort.total >= 0`, `effort.buffer >= 0`, `effort.actual >= 0`
- `members[].dailyEffort in [0.1, 1.5]`
- 日付文字列は `YYYY-MM-DD` の厳格フォーマット
- `projectId` は `[a-zA-Z0-9_-]{1,64}`

NG時:
1. 保存拒否
2. UIエラー通知
3. 監査ログ `result=validation_error`

## 3.3 マイグレーション方針

- `schemaVersion` をSemVerとして比較。
- `1.0.x -> 1.1.0` のようなマイナーアップ時のみ自動移行。
- メジャー不一致時は読み取り専用モード + ユーザー通知。

---

## 4. 設定ファイル解決ロジック

## 4.1 読み込み候補探索

1. `kousu.projects/*.local.json`
2. `kousu.projects/*.json`
3. `kousu.config.json`

## 4.2 アクティブプロジェクト解決アルゴリズム

1. UI選択中 `selectedProjectId` があれば採用。
2. `kousu.activeProjectId` 設定を参照。
3. `kousu.config.json` が単一構成なら採用。
4. 複数候補が残る場合は「プロジェクト選択クイックピック」を表示してユーザー選択。
5. 非対話コンテキスト（API経由など）では `projectId` 昇順先頭を採用。

## 4.3 競合解決

同一 `projectId` が複数ファイルにある場合:

- 優先: `.local.json` > `.json` > `kousu.config.json`
- 非採用エントリを `ConflictRecord` として保持

```ts
interface ConflictRecord {
  projectId: string;
  selectedFile: string;
  ignoredFiles: string[];
  detectedAtUtc: string;
}
```

---

## 5. 工数計算詳細

## 5.1 稼働日計算

`workingDayCalculator.calculate(start, end, exclusions): DateYmd[]`

- 入力日付はローカル日付文字列のまま比較。
- 除外優先順位: 個人休暇 > 会社休暇 > 週末（重複は1日）。
- 休暇ソース欠損時は `fallback_weekend_only` を返却。

## 5.2 予測計算

### 5.2.1 算出式

- `averageVelocity = actual / elapsedWorkingDays`
- `predictedTotalEffort = averageVelocity * totalWorkingDays`
- `remainingEffort = budget - actual`

`budget` の定義:
- `exclusive`: `budget = total + buffer`（バッファ外数）
- `inclusive`: `budget = total`（バッファ内数、閾値判定に `buffer` を利用）

### 5.2.2 枯渇予測日

- `daysToDeplete = ceil(remainingEffort / averageVelocity)`
- 今日以降の稼働日配列に `daysToDeplete` を適用
- `remainingEffort < 0` は `depletionDate=today`, `exceededEffort=abs(remainingEffort)`

### 5.2.3 ゼロ状態

- `actual=0` または `elapsedWorkingDays=0` は `insufficient_data`
- `endDate < today` は `period_closed`
- 0除算/NaN/Infinity 検知時は前回正常結果を再利用

## 5.3 警告レベル判定

`alertEvaluator.evaluate(config, forecast): AlertState`

前提値:
- `thresholdActual`（注意開始）
  - `exclusive`: `total - buffer`
  - `inclusive`: `total - buffer`
- `thresholdHard`（上限）
  - `exclusive`: `total + buffer`
  - `inclusive`: `total`

判定:
- 正常: `actual < thresholdActual` かつ `predictedTotalEffort <= thresholdHard`
- 注意: `thresholdActual <= actual <= thresholdHard`
- 警告: `actual > thresholdHard` または `predictedTotalEffort > thresholdHard`

---

## 6. 外部連携詳細

## 6.1 ローカルHTTP API

- バインド: `127.0.0.1:{port}`
- 認証: `Authorization: Bearer <token>` 必須
- トークン: `KOUSU_API_TOKEN`
- 起動条件: `integration.api.enabled=true` かつ token取得成功

## 6.2 エンドポイント仕様

### GET `/api/v1/projects/:id/progress`
- 200: `ProgressDto`

```ts
interface ProgressDto {
  projectId: string;
  projectName: string;
  progressRate: number; // 0-100
  remainingEffort: number;
  predictedEndDate?: DateYmd;
  alertLevel: "normal" | "caution" | "warning";
  forecastStatus: ForecastResult["status"];
  updatedAtUtc: string;
}
```
- 404: `project_not_found`
- 401: `unauthorized`

### PATCH `/api/v1/projects/:id/effort`
- 入力: `{ total?: number, buffer?: number, actual?: number }`
- 200: 更新後 `ProjectConfig`（一部マスク）
- 400: `validation_error`

### POST `/api/v1/projects/:id/holidays/sync`
- 入力: `HolidaySyncRequest`

```ts
interface HolidaySyncRequest {
  sources: Array<{
    kind: "company" | "member";
    type: "file" | "api" | "csv";
    path?: string;
    endpoint?: string;
    memberName?: string;
  }>;
  dryRun?: boolean;
}
```
- 202: 非同期同期ジョブ受理
- 503: `source_unavailable`

## 6.3 レート制限

- 認証失敗が連続5回で5分ブロック。
- ブロック中レスポンスは 429。

---

## 7. UI詳細設計

## 7.1 サイドバーTreeView

表示ノード:
1. Project: `projectName`
2. Progress: `xx%`
3. Remaining: `yy person_day`
4. Alert: `正常|注意|警告`

コマンド:
- `kousu.selectProject`
- `kousu.updateActual`
- `kousu.openDashboard`
- `kousu.syncHolidays`

## 7.2 Webview状態同期

- Extension Host -> Webview は `postMessage`。
- メッセージ型:
  - `dashboard:init`
  - `dashboard:update`
  - `dashboard:error`

```ts
interface DashboardUpdateMessage {
  type: "dashboard:update";
  payload: {
    kpi: KpiViewModel;
    burndown: BurndownPoint[];
    alerts: AlertViewModel[];
    holidaySyncStatus: HolidaySyncStatus;
  };
}
```

## 7.3 通知制御

- 情報: 同期成功
- 警告: バッファ突入/同期フォールバック
- エラー: 保存失敗/設定破損
- 同一メッセージの連続表示は 30 秒デバウンス

---

## 8. 監査ログ詳細

- ファイル: `./.kousu/logs/audit.log`
- フォーマット: JSON Lines
- ログ例:

```json
{"timestamp":"2026-05-09T09:00:00Z","actor":"user","action":"update_effort","target":"project:p-001","before":{"actual":40},"after":{"actual":45},"result":"success"}
```

マスキングルール:
- `token`, `authorization` キーは `"***"` に置換
- 200KB超 payload は末尾切り捨て + `truncated=true`

---

## 9. 例外処理・復旧フロー

## 9.1 設定破損時

1. schema検証失敗
2. `*.broken.<timestamp>` へ退避
3. 最終正常バックアップ復元
4. 通知 + 修復ガイド表示

## 9.2 同期失敗時

- 1回目失敗: 1秒後再試行
- 2回目失敗: 2秒後再試行
- 3回目失敗: 4秒後再試行
- 全失敗時: 前回データ採用 + Warning通知

## 9.3 APIサーバー異常

- ポート競合時は自動で次ポート探索しない（誤接続回避）
- 明示エラー通知し手動再設定を促す

---

## 10. テスト詳細設計

## 10.1 単体テスト

- `workingDayCalculator`
  - 土日除外
  - 休暇重複除外
  - 期間境界（start=end）
- `forecastCalculator`
  - 通常ケース
  - `insufficient_data`
  - `period_closed`
  - 超過時の `exceededEffort`
- `alertEvaluator`
  - 正常/注意/警告遷移
  - inclusive/exclusive 境界

## 10.2 結合テスト

- 設定読み込み → 再計算 → TreeView更新
- PATCH API → 設定保存 → 監査ログ記録
- Holiday同期失敗 → フォールバック表示

## 10.3 E2E観点

- 初期化コマンドでテンプレート生成される
- 実績入力でダッシュボードKPIが即時更新される
- 競合設定検知時に詳細パネルが表示される

---

## 11. 実装ステップ（推奨）

1. Domain層（計算ロジックと単体テスト）
2. Config Repository + バリデーション/マイグレーション
3. Applicationユースケース実装
4. サイドバー表示と基本コマンド
5. Webviewダッシュボード
6. ローカルAPI + 認証 + 監査ログ
7. 同期リトライ・競合UI・運用補助機能

