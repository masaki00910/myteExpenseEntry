# Skill E: myTE Travel - Public, Limo, & Other 経費自動入力

## 概要

公共交通機関（電車・バス等）の経費データをPlaywrightでmyTEに自動入力する。通勤交通費など毎月繰り返し登録するユースケースを想定し、前回ピリオドの期間終了日を取得して今回の開始日を特定する機能を持つ。

## 実行スクリプト

```
.claude/skills/skill-e-myte-public-transport-entry/scripts/myte_public_transport_entry.js
```

実行コマンド（プロジェクトルートから）:
```bash
node .claude/skills/skill-e-myte-public-transport-entry/scripts/myte_public_transport_entry.js <entryId>
```

- OCR/画像添付は不要。entry.json の myte_fields のみ使用する。
- ブラウザを閉じるとステータスが `submitted` に自動更新される。

## 前提条件

- Playwrightが使用可能であること（`npm install playwright` でインストール済み）
- ブラウザはSSO認証済みのセッションを使用（永続コンテキスト: `.myte/browser-data/`）
- 対象: **Travel - Public, Limo, & Other のみ**
- 通貨: JPY固定、国: Japan固定

## トリガー

- 「交通費を登録して」「通勤費を登録して」「電車代を登録して」

※ OCR不要のため Skill A からは呼ばれない。ユーザーが直接このSkillを起動する。

## 入力データ

ユーザーから直接 myte_fields の情報を受け取る、または `data/pending/{folder}/entry.json` を指定する。

entry.json の myte_fields 例:

```json
{
  "charge_code": "CJDK4001",
  "country_region": "Japan",
  "currency": "JPY",
  "from_date": "2026/02/16",
  "to_date": "2026/02/28",
  "reason": "Home <-> Client Site/Other Office",
  "type": "Public Transportation",
  "trip_no": "20",
  "one_trip_amount": 580,
  "consumption_type": "Consumption Tax 10%",
  "qualified_invoice": true,
  "vat_registered_number": "",
  "from_location": "渋谷駅",
  "to_location": "六本木オフィス",
  "comments": "",
  "public_official_above_25": false
}
```

## Playwright操作手順

### Playwright設定

```javascript
const { chromium } = require('playwright');
const path = require('path');

const userDataDir = path.join('C:\\work\\2026\\20260301_claude_skills_myTE', '.myte', 'browser-data');
const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1920, height: 1080 },
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  args: [
    '--restore-last-session',
    '--disable-features=ClearSessionCookiesOnExit',
    '--enable-features=RestoreSessionStateForNTP',
  ],
});
const page = browser.pages()[0] || await browser.newPage();
```

### Phase 1: ページアクセス（前回ピリオド確認含む）

1. `https://myte.accenture.com/#/time` にアクセス
2. SSOチェック（URLに `login` / `sso` が含まれたら SSO対処へ）
3. `EXPENSES` タブをクリック
4. **前回ピリオドに移動**: ピリオド切り替えボタン（前へ）をクリック
5. **前回ピリオドの期間終了日を取得**: EXPENSESタブ内の登録済みエントリから期間を読み取る
6. **今のピリオドに戻る**: ピリオド切り替えボタン（次へ）をクリック
7. 「Select Expenses to Add」ドロップダウン (`#comboboxselect-expense-dropdown`) を開く
8. `li[aria-label="Travel - Public, Limo, & Other add expense"]` を選択
9. フォーム表示を待つ (`h1:has-text("Travel - Public, Limo, & Other")`)

### Phase 2: フォーム入力

| # | フィールド | セレクター | 入力方法 | 備考 |
|---|---|---|---|---|
| 1 | Charge Code | `[aria-label="Select a Charge Code"]` → 開く → `#filter-text` にコード入力 → `div[aria-label*="Charge Code: {code}"]` クリック | クリック | Disabledの行は選択不可 |
| 2 | Country/Region | `[aria-label*="Country/Region of Expense"]` | デフォルトJapan | 通常スキップ |
| 3 | Currency | `[aria-label*="Currency"]` | デフォルトJP-JPY | 通常スキップ |
| 4 | From (開始日) | `#from_input` に fill → Tabキーで確定 | fill | yyyy/mm/dd形式 |
| 5 | To (終了日) | `#to_input` に fill → Tabキーで確定 | fill | yyyy/mm/dd形式 |
| 6 | Reason | `[aria-label*="Reason:"]` クリック → `li[aria-label="{value}"]` 選択 | クリック | HTMLエンティティ注意: `<->` が `&lt;-&gt;` の場合あり |
| 7 | Other (Reason) | `#other_input` に fill | fill | Reason="Other"の場合のみ。有効化を待ってから入力 |
| 8 | Type | `[aria-label*="Type:"]` クリック → `li[aria-label="{value}"]` 選択 | クリック | Public Transportation / Limo / Other / Car Service |
| 9 | Trip No. | `#trip no._input` に fill | fill | 必須。数値文字列 |
| 10 | One Trip Amount | `#one trip amount_input` に fill | fill | 必須。片道運賃（数値） |
| 11 | Consumption Type | `[aria-label*="Consumption Type:"]` クリック → `li[aria-label="{value}"]` 選択 | クリック | No Consumption Tax / 8% / 10% |
| 12 | Qualified Invoice | `[aria-label*="Qualified Invoice"]` チェックボックス | クリック | true時のみクリック |
| 13 | VAT Registered Number | `#vat registered number_input` に fill | fill | 任意。空なら操作不要 |
| 14 | From Location | `#from location_input` に fill | fill | 必須 |
| 15 | To Location | `#to location_input` に fill | fill | 必須 |
| 16 | Comments | `#comments_input` に fill | fill | 任意、最大200文字。空なら操作不要 |
| 17 | Public Official | `[aria-label*="Provided to a Public"]` チェックボックス | クリック | デフォルトunchecked。true時のみクリック |

**自動計算フィールド**（入力不要）:
- Amount: One Trip Amount × Trip No. で自動計算
- Number of Days: From/To の日数差で自動計算
- Final Amount: Amount × Conversion Rate で自動計算
- Tax: Consumption Type に応じて自動計算

**重要**: 各操作間に `page.waitForTimeout(300)` を入れてUIの反映を待つ。

### Reason の選択肢

- Home <-> Airport/Train
- Home <-> Home Office
- Home <-> Client Site/Other Office
- Client Site <-> Airport/Train
- Client Site <-> Client Site
- Hotel <-> Airport/Train
- Hotel <-> Client Site/Other Office
- Hotel <-> Other Office
- Other

### Type の選択肢

- Public Transportation
- Limo
- Other
- Car Service

### Consumption Type の選択肢

- No Consumption Tax
- Consumption Tax 8%
- Consumption Tax 10%

### Phase 3: 入力完了

1. 全フィールド入力後、入力完了をユーザーに通知する:
   ```
   ✅ フォーム入力が完了しました
   Charge Code: CJDK4001
   From: 2026/02/16 → To: 2026/02/28
   Type: Public Transportation
   Trip No.: 20 × ¥580 = (自動計算)
   From: 渋谷駅 → To: 六本木オフィス
   ブラウザで内容を確認し、問題なければSaveボタンを押してください。
   ```
2. **Saveボタンは押さない**（ユーザーがブラウザ上で確認・Save/キャンセルを判断する）
3. ユーザーがSave完了を報告したら、`data/pending/{folder}/entry.json` の statusを `submitted` に更新し、`data/pending/{folder}/` フォルダごと `data/done/{folder}/` に移動する
4. キャンセルされた場合はstatusを `failed` に更新する

### Phase 4: 保存後処理

保存成功時:
```
✅ myTEへの登録が完了しました

Charge Code: CJDK4001
Period: 2026/02/16 - 2026/02/28
Type: Public Transportation
Trip: 20 × ¥580

履歴ステータスを「submitted」に更新しました。
```

## エラーハンドリング

| エラー | 検出方法 | 対処 |
|---|---|---|
| SSOセッション切れ | URLに `login` / `sso` が含まれる | `セッション保存.bat` を実行してセッション再取得 |
| 要素未発見 | 各操作にタイムアウト10秒 | セレクター情報とともにエラー報告 |
| Charge Code未発見 | フィルター後に該当行0件 | WBSマッピング確認を促す |
| Charge Code無効 | `error-cell` クラスまたは aria-label末尾に `Disabled` | 「このCharge Codeは無効です」と報告 |
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
- セレクターにスペースを含むID（`#trip no._input`, `#one trip amount_input`, `#from location_input`等）は `page.locator('[id="trip no._input"]')` 形式で指定する
