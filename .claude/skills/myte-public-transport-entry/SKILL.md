# Skill E: myTE Travel - Public, Limo, & Other 経費自動入力

## 概要

公共交通機関（電車・バス等）の経費データをPlaywrightでmyTEに自動入力する。通勤交通費など毎月繰り返し登録するユースケースを想定し、前回ピリオドの期間終了日を取得して今回の開始日を特定する機能を持つ。

## 実行スクリプト

```
.claude/skills/myte-public-transport-entry/scripts/myte_public_transport_entry.js
```

実行コマンド（プロジェクトルートから）:
```bash
node .claude/skills/myte-public-transport-entry/scripts/myte_public_transport_entry.js <entryId>
```

**⚠️ 重要: 必ずこのスクリプトファイルを直接実行すること。一時ファイルを作成してハードコーディングしたスクリプトを実行してはならない。**

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

## 処理フロー

### Step 1: 前回請求情報の取得（Bash でスクリプト実行）

**ユーザーに何も聞く前に**、まず以下のスクリプトを Bash で実行する:

```bash
node .claude/skills/myte-public-transport-entry/scripts/get_previous_period.js
```

このスクリプトは:
1. myTE にアクセス（SSO切れの場合はブラウザで認証待ち）
2. 前回ピリオドの EXPENSES タブを確認
3. Travel - Public, Limo, & Other の To 日付を取得
4. 今のピリオドに戻る
5. **stdout に JSON を出力して終了**: `{"lastDate":"2/15/2026","success":true}`

スクリプトの stdout 出力（JSON）をパースし、`lastDate` を取得する。

取得結果をもとに以下を自動算出する:
- **From（開始日）**: 前回請求済み終了日の翌日
- **To（終了日）**: 本日（スキル実行日、`currentDate` から取得）
- **営業日数**: From〜To間の営業日数（土日・日本の祝日を除外）
- **Trip No.（往復回数）**: 営業日数 × 2

**営業日数の算出ルール:**
- 土曜日・日曜日を除外する
- 日本の祝日（国民の祝日）を除外する
- 祝日データは `currentDate` のシステム情報から年を特定し、その年の祝日を考慮する

**lastDate が null の場合**（前回エントリなし）: ユーザーに From 日付を直接入力してもらう

### Step 2: 登録内容の確認（AskUserQuestion を使用）

Step 1 の算出結果を提案値として提示し、**AskUserQuestion** でユーザーに確認・修正を求める。

**提示メッセージ（AskUserQuestion 呼び出し前）:**
```
交通費の登録内容を確認します。

前回請求済み終了日: 2026/02/15
今回の提案:
  期間: 2026/02/16 〜 2026/03/04（本日）
  営業日数: 12日
  往復回数（Trip No.）: 24回（12日 × 2）
```

**1回目の AskUserQuestion:**
```
AskUserQuestion({
  questions: [
    {
      question: "WBSコマンドまたはCharge Codeを入力してください",
      header: "WBS",
      multiSelect: false,
      options: [
        // wbs_mapping.json の登録済みコマンドを動的に表示
        // 例: { label: "sb", description: "CJDK4001 - Softbank Corp." }
      ]
      // "Other" → notes に Charge Code を直接入力
    },
    {
      question: "Reason（利用理由）を選択してください",
      header: "Reason",
      multiSelect: false,
      options: [
        { label: "Home <-> Home Office", description: "自宅と自社オフィス間" },
        { label: "Home <-> Airport/Train", description: "自宅と空港/駅間" },
        { label: "Hotel <-> Client Site/Other Office", description: "ホテルと客先/他オフィス間" },
        { label: "Hotel <-> Airport/Train", description: "ホテルと空港/駅間" }
      ]
      // "Other" が選択された場合:
      // 残りの選択肢を番号付きテキストで提示し、番号で選んでもらう:
      //   1. Home <-> Client Site/Other Office（自宅と客先/他オフィス間）
      //   2. Client Site <-> Airport/Train（客先と空港/駅間）
      //   3. Client Site <-> Client Site（客先間）
      //   4. Hotel <-> Other Office（ホテルと他オフィス間）
      //   5. Other（自由入力 → notes に正確な値を入力）
    },
    {
      question: "Type（交通機関の種類）を選択してください",
      header: "Type",
      multiSelect: false,
      options: [
        { label: "Public Transportation", description: "電車・バス等の公共交通機関" },
        { label: "Limo", description: "リムジンバス等" },
        { label: "Car Service", description: "カーサービス" }
      ]
    },
    {
      question: "片道運賃（One Trip Amount）を入力してください（円）",
      header: "金額",
      multiSelect: false,
      options: [
        { label: "580", description: "例: 渋谷→六本木" },
        { label: "1000", description: "例: 新宿→横浜" }
      ]
      // "Other" → notes に正確な金額を入力
    }
  ]
})
```

**2回目の AskUserQuestion（提案値の確認）:**
```
AskUserQuestion({
  questions: [
    {
      question: "出発地 (From Location) を入力してください",
      header: "From",
      multiSelect: false,
      options: [
        { label: "自宅", description: "自宅から出発" },
        { label: "会社オフィス", description: "社内オフィスから出発" },
        { label: "客先オフィス", description: "客先オフィスから出発" }
      ]
    },
    {
      question: "到着地 (To Location) を入力してください",
      header: "To",
      multiSelect: false,
      options: [
        { label: "自宅", description: "自宅に到着" },
        { label: "会社オフィス", description: "社内オフィスに到着" },
        { label: "客先オフィス", description: "客先オフィスに到着" }
      ]
    },
    {
      question: "期間とTrip No.を確認してください（提案: {from} 〜 {to}、{trip_no}回）",
      header: "期間",
      multiSelect: false,
      options: [
        { label: "提案通り", description: "{from} 〜 {to}、営業日{n}日 × 2 = {trip_no}回" },
        { label: "期間を変更", description: "日付やTrip No.を手動で指定" }
      ]
      // "Other" → notes に "2026/02/16 - 2026/02/28, 20" 形式で入力
    }
  ]
})
```

「期間を変更」が選択された場合は、追加の AskUserQuestion で From日付、To日付、Trip No. を個別に収集する。

**"Other" が選択された場合のルール:**
- `annotations[question].notes` に入力されたテキストを実際の値として使用する
- notes が空の場合はユーザーに再入力を依頼する

### Step 3: WBSコマンド解決

`.myte/wbs_mapping.json` でコマンドを検索し、Charge Code を特定する（Skill Bのコマンド解決ロジックと同じ）。

### Step 4: entry.json 作成

`data/pending/{folder}/entry.json` を作成する。フォルダ名: `{from_yyyymmdd}-transport-{charge_code}`

### Step 5: スクリプト実行

収集した情報で entry.json を作成した後、Playwrightスクリプトを実行する。

```bash
node .claude/skills/myte-public-transport-entry/scripts/myte_public_transport_entry.js {entryId}
```

### 必須フィールド一覧

| フィールド | 説明 | 取得方法 |
|---|---|---|
| Charge Code | WBSコード | AskUserQuestion → WBS解決 |
| Country/Region | 経費発生国 | Japan（固定） |
| Currency | 通貨 | JPY（固定） |
| From (開始日) | 期間開始日 | 自動算出（前回終了日+1）→ 確認 |
| To (終了日) | 期間終了日 | 自動算出（本日）→ 確認 |
| Reason | 理由 | AskUserQuestion |
| Type | 交通機関の種類 | AskUserQuestion |
| Trip No. | 往復回数 | 自動算出（営業日×2）→ 確認 |
| One Trip Amount | 片道運賃 | AskUserQuestion |
| Consumption Type | 消費税タイプ | Consumption Tax 10%（デフォルト） |
| Qualified Invoice | 適格請求書 | false（デフォルト） |
| From Location | 出発地 | AskUserQuestion |
| To Location | 到着地 | AskUserQuestion |
| Comments | コメント（任意） | 空欄（デフォルト） |
| Public Official >$25 | 公務員提供チェック | false（デフォルト） |

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
