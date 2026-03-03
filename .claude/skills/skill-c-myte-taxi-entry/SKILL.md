# Skill C: myTE Travel-Taxi 経費自動入力

## 概要

Skill Aで確定した経費データをPlaywrightでmyTEに自動入力する。入力完了後、OCR履歴のstatusを更新する。

## 実行スクリプト

```
.claude/skills/skill-c-myte-taxi-entry/scripts/myte_taxi_entry.js
```

実行コマンド（プロジェクトルートから）:
```bash
node .claude/skills/skill-c-myte-taxi-entry/scripts/myte_taxi_entry.js
```

## 前提条件

- Playwrightが使用可能であること（`npm install playwright` でインストール済み）
- ブラウザはSSO認証済みのセッションを使用（永続コンテキスト: `.myte/browser-data/`）
- 対象: **Travel - Taxi のみ**
- 通貨: JPY固定、国: Japan固定

## トリガー

- **Skill Aからの自動呼び出し**: expense_type が `Travel - Taxi` の場合、Skill A の Step 9 で自動的にこのSkillが呼ばれる
- 「myTEに登録して」「経費を申請して」「タクシー代を登録して」
- 直接呼び出し: `data/pending/{folder}/entry.json` のパスを指定

## 入力データ

`data/pending/{folder}/entry.json` を読み込んで使用する。Skill A から呼ばれた場合は、直前に confirmed された entry.json を自動で特定する。

entry.json の例:

```json
{
  "history_id": "20260301_001",
  "expense_type": "Travel - Taxi",
  "myte_fields": {
    "charge_code": "CJDK4001",
    "amount": 3500,
    "country_region": "Japan",
    "currency": "JPY",
    "on_date": "2026/03/01",
    "reason": "Home <-> Client Site/Other Office",
    "purpose": "公共の交通機関がタクシー以外にない",
    "consumption_type": "Consumption Tax 10%",
    "vat_registered_number": "T1234567890123",
    "from_location": "渋谷駅",
    "to_location": "六本木オフィス",
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
4. `li[aria-label="Travel - Taxi add expense"]` を選択
5. フォーム表示を待つ (`h1:has-text("Travel - Taxi")`)

### Phase 2: フォーム入力

各フィールドのセレクターと入力方法:

| # | フィールド | セレクター/操作方法 | 備考 |
|---|---|---|---|
| 1 | Charge Code | `[aria-label="Select a Charge Code"]` → 開く → `#filter-text` にコード入力 → 該当行 `div[aria-label*="Charge Code: {code}"]` をクリック | Disabledの行は選択不可 |
| 2 | Amount | `#amount_input` に `fill` | 数値のみ |
| 3 | Country/Region | デフォルトJapanで選択済み。変更時のみ `[aria-label*="Country/Region of Expense"]` を操作 | 通常スキップ |
| 4 | Currency | デフォルトJPYで選択済み | 通常スキップ |
| 5 | On (日付) | `#on_input` に `fill` → Tabキーで確定 | yyyy/mm/dd形式 |
| 6 | Reason | `[aria-label*="Reason:"]` クリック → `li[aria-label="{value}"]` 選択 | HTMLエンティティ注意: `<->` が `&lt;-&gt;` の場合あり |
| 7 | Purpose | `[aria-label*="Purpose:"]` クリック → `li[aria-label="{value}"]` 選択 | 日本語選択肢 |
| 8 | Consumption Type | デフォルト10%。変更時のみ `[aria-label*="Consumption Type:"]` を操作 | 通常スキップ |
| 9 | VAT Registered Number | `#vat_registered_number_input` に `fill` | T+13桁 |
| 10 | From Location | `#from_location_input` に `fill` | 自由入力 |
| 11 | To Location | `#to_location_input` に `fill` | 自由入力 |
| 12 | Comments | `#comments_input` に `fill` | 任意、最大200文字。空なら操作不要 |
| 13 | Public Official | `[aria-label*="Provided to a Public"]` のチェックボックス | デフォルトunchecked。true時のみクリック |

**重要**: 各操作間に `page.waitForTimeout(300)` を入れてUIの反映を待つ。

### Phase 3: 入力完了

1. 全フィールド入力後、入力完了をユーザーに通知する:
   ```
   ✅ フォーム入力が完了しました（ID: 20260301_001）
   ブラウザで内容を確認し、問題なければSaveボタンを押してください。
   ```
2. **Saveボタンは押さない**（ユーザーがブラウザ上で確認・Save/キャンセルを判断する）
3. ユーザーがSave完了を報告したら、`data/pending/{folder}/entry.json` の statusを `submitted` に更新し、`image_path` を `data/done/...` に書き換えてから `data/pending/{folder}/` フォルダごと `data/done/{folder}/` に移動する（`fs.renameSync`）
4. キャンセルされた場合はstatusを `failed` に更新する

### Phase 4: 保存後処理

保存成功時:
```
✅ myTEへの登録が完了しました（ID: 20260301_001）

Charge Code: CJDK4001
Amount: ¥3,500
Date: 2026/03/01

履歴ステータスを「submitted」に更新しました。
```

## エラーハンドリング

| エラー | 検出方法 | 対処 |
|---|---|---|
| SSOセッション切れ | URLに `login` / `sso` が含まれる | `セッション保存.bat` を実行してセッション再取得 |
| 要素未発見 | 各操作にタイムアウト10秒 | セレクター情報とともにエラー報告 |
| Charge Code未発見 | フィルター後に該当行0件 | WBSマッピング確認を促す |
| Saveボタン無効 | ボタンのdisabled状態 | 必須フィールド未入力の可能性。エラーメッセージを取得して報告 |
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

- **Saveボタンは押さない**（ユーザーがブラウザ上で確認・保存する）
- myTEのUI更新でセレクターが変わる可能性があるため、動作しない場合はHTMLを確認してセレクターを更新する
- ネットワーク遅延を考慮した待機処理を入れる
- Reasonフィールドの `<->` がHTMLエンティティ `&lt;-&gt;` として表示される場合があるため、aria-labelの検索時に両方のパターンを試す
- ブラウザウィンドウはユーザーが操作状況を確認できるよう `headless: false` で起動する
