# Skill D: myTE Accommodation-Hotel 経費自動入力

## 概要

Skill Aで確定したホテル経費データをPlaywrightでmyTEに自動入力する。入力完了後、OCR履歴のstatusを更新する。

## 実行スクリプト

```
.claude/skills/myte-hotel-entry/scripts/myte_hotel_entry.js
```

実行コマンド（プロジェクトルートから）:
```bash
node .claude/skills/myte-hotel-entry/scripts/myte_hotel_entry.js
```

**⚠️ 重要: 必ずこのスクリプトファイルを直接実行すること。一時ファイルを作成してハードコーディングしたスクリプトを実行してはならない。**

## 前提条件

- Playwrightが使用可能であること（`npm install playwright` でインストール済み）
- ブラウザはSSO認証済みのセッションを使用（永続コンテキスト: `.myte/browser-data/`）
- 対象: **Accommodation - Hotel のみ**
- 通貨: JPY固定、国: Japan固定

## トリガー

- **Skill Aからの自動呼び出し**: expense_type が `Accommodation - Hotel` の場合、Skill A の Step 9 で自動的にこのSkillが呼ばれる
- 「ホテル代を登録して」「宿泊費を登録して」「ホテルの経費を申請して」
- 直接呼び出し: `data/pending/{folder}/entry.json` のパスを指定

## 入力データ

`data/pending/{folder}/entry.json` を読み込んで使用する。Skill A から呼ばれた場合は、直前に confirmed された entry.json を自動で特定する。

entry.json の例:

```json
{
  "history_id": "20260301_002",
  "expense_type": "Accommodation - Hotel",
  "myte_fields": {
    "charge_code": "CJDK4001",
    "amount": 12000,
    "country_region": "Japan",
    "currency": "JPY",
    "check_in_date": "2026/03/01",
    "check_out_date": "2026/03/02",
    "hotel_name": "東横イン渋谷",
    "hotel_city": "東京都渋谷区",
    "consumption_type": "Consumption Tax 10%",
    "vat_registered_number": "T9876543210123",
    "comments": "",
    "public_official_above_25": false
  }
}
```

## Playwright操作手順

### Playwright設定

```javascript
const { chromium } = require('playwright');
const path = require('path');

// 永続コンテキスト（SSO認証セッション維持）
const userDataDir = path.join('C:\\work\\2026\\20260301_claude_skills_myTE', '.myte', 'browser-data');
const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1920, height: 1080 },
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo'
});
const page = browser.pages()[0] || await browser.newPage();
```

### Phase 1: ページアクセス

1. `https://myte.accenture.com/#/time` にアクセス
2. `EXPENSES` タブをクリック
3. 「Select Expenses to Add」ドロップダウン (`#comboboxselect-expense-dropdown`) を開く
4. `li[aria-label="Accommodation - Hotel add expense"]` を選択
5. フォーム表示を待つ (`h1:has-text("Accommodation - Hotel")`)

### Phase 2: フォーム入力

各フィールドのセレクターと入力方法:

| # | フィールド | セレクター/操作方法 | 備考 |
|---|---|---|---|
| 1 | Charge Code | `[aria-label="Select a Charge Code"]` → 開く → `#filter-text` にコード入力 → 該当行 `div[aria-label*="Charge Code: {code}"]` をクリック | Disabledの行（`aria-label` 末尾に `, Disabled`）は選択不可。`error-cell` クラスで判別可能 |
| 2 | Amount | `#amount_input` に `fill` | 数値のみ（税込合計） |
| 3 | Country/Region | デフォルトJapanで選択済み。変更時のみ `[aria-label*="Country/Region of Expense"]` を操作 | 通常スキップ |
| 4 | Currency | デフォルトJPYで選択済み | 通常スキップ |
| 5 | Check-in (日付) | `#check_in_input` に `fill` → Tabキーで確定 | yyyy/mm/dd形式 |
| 6 | Check-out (日付) | `#check_out_input` に `fill` → Tabキーで確定 | yyyy/mm/dd形式 |
| 7 | Hotel Name | `#hotel_name_input` に `fill` | 自由入力 |
| 8 | Hotel City | `#hotel_city_input` に `fill` | 自由入力 |
| 9 | Consumption Type | デフォルト10%。変更時のみ `[aria-label*="Consumption Type:"]` を操作 | 通常スキップ |
| 10 | VAT Registered Number | `#vat_registered_number_input` に `fill` | T+13桁 |
| 11 | Comments | `#comments_input` に `fill` | 任意、最大200文字。空なら操作不要 |
| 12 | Public Official | `[aria-label*="Provided to a Public"]` のチェックボックス | デフォルトunchecked。true時のみクリック |

**重要**:
- 各操作間に `page.waitForTimeout(300)` を入れてUIの反映を待つ
- セレクターが見つからない場合は、ページのHTMLを取得して実際のid/aria-labelを確認し、動的に対応する

### セレクター補足（実際のHTML観察に基づく）

Charge Codeグリッドの行の状態判別:

| 状態 | aria-label末尾 | CSSクラス | 選択可否 |
|---|---|---|---|
| 有効 | `Country/Region: Japan"` | `cursor-pointer` | 選択可 |
| 無効（Closed） | `Disabled"` | `error-cell cursor-pointer` | 選択不可 |
| 無効（不存在） | `Disabled"` | `error-cell cursor-pointer` | 選択不可 |

Saveボタン:
- セレクター: `button.myte-button-submit`（`button:has-text("Save")` でも可）
- disabled属性がある場合は必須フィールド未入力

### Phase 3: 入力完了

1. 全フィールド入力後、入力完了をユーザーに通知する:
   ```
   ✅ フォーム入力が完了しました（ID: 20260301_002）
   ブラウザで内容を確認し、問題なければSaveボタンを押してください。
   ```
2. **Saveボタンは押さない**（ユーザーがブラウザ上で確認・Save/キャンセルを判断する）
3. ユーザーがSave完了を報告したら、`data/pending/{folder}/entry.json` の statusを `submitted` に更新し、`image_path` を `data/done/...` に書き換えてから `data/pending/{folder}/` フォルダごと `data/done/{folder}/` に移動する（`fs.renameSync`）
4. キャンセルされた場合はstatusを `failed` に更新する

### Phase 4: 保存後処理

保存成功時:
```
✅ myTEへの登録が完了しました（ID: 20260301_002）

Charge Code: CJDK4001
Amount: ¥12,000
Check-in: 2026/03/01 → Check-out: 2026/03/02
Hotel: 東横イン渋谷（東京都渋谷区）

履歴ステータスを「submitted」に更新しました。
```

## エラーハンドリング

| エラー | 検出方法 | 対処 |
|---|---|---|
| SSOセッション切れ | URLに `login` / `sso` が含まれる | `セッション保存.bat` を実行してセッション再取得 |
| 要素未発見 | 各操作にタイムアウト10秒 | セレクター情報とともにエラー報告。ページHTMLを取得して正しいセレクターを特定する |
| Charge Code未発見 | フィルター後に該当行0件 | WBSマッピング確認を促す |
| Charge Code無効 | 選択した行に `error-cell` クラスまたは aria-label末尾に `Disabled` | 「このCharge Codeは無効です（Closed/不存在）。別のコードを指定してください」と報告 |
| Saveボタン無効 | `button.myte-button-submit` の `disabled` 属性 | 必須フィールド未入力の可能性。エラーメッセージを取得して報告 |
| ネットワークエラー | ページ読み込み失敗 | リトライを提案 |

### SSOセッション切れの対処

ページアクセス後にURLに `login` や `sso` が含まれる場合、以下の手順でセッションを再取得する。

1. **現在のブラウザを閉じる**（開いていた Playwright コンテキストを close）
2. **`セッション保存.bat` を新しいターミナルで実行する**:
   ```bash
   start cmd /c "C:\work\2026\20260301_claude_skills_myTE\セッション保存.bat"
   ```
3. **ユーザーに以下を表示する**:
   ```
   ⚠️ SSOセッションが切れています。
   別ウィンドウで「セッション保存.bat」を起動しました。

   1. 開いたブラウザでSSO認証を完了してください
   2. myTEのトップページが表示されたらターミナルでEnterキーを押してください
   3. 完了したら「続行」と入力してください
   ```
4. ユーザーが「続行」と回答したら、Phase 1 からリトライする

## Playwright実行時の注意事項

- Saveは**絶対にユーザー確認後にのみ**実行する
- myTEのUI更新でセレクターが変わる可能性があるため、動作しない場合はHTMLを確認してセレクターを更新する
- ネットワーク遅延を考慮した待機処理を入れる
- ブラウザウィンドウはユーザーが操作状況を確認できるよう `headless: false` で起動する
- Hotel Nameのフィールドidが不明な場合は `input[aria-label*="Hotel Name"]` や `input[aria-label*="hotel"]` でフォールバック検索する
