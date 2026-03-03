# Skill A: 領収書OCR & 情報抽出

## 概要

ユーザーから領収書画像とWBSコマンド（またはコード）を受け取り、OCRで情報を抽出し、myTE登録に必要なデータを整理する。画像と処理結果は履歴として保存する。

## トリガー

以下のいずれかでこのスキルを起動する:
- ユーザーが領収書画像を添付した時
- 「経費登録」「レシート読み取り」「OCRして」「領収書を読み込んで」などのキーワード

## 処理フロー

### Step 1: 画像受け取りと保存

ユーザーからの画像提供は以下の2パターンがある。どちらの場合もOCR処理を実行する。

#### パターンA: チャットに画像を直接貼り付け

1. Claudeがマルチモーダル機能で画像を直接認識・OCR処理する
2. **画像一時保存（必須）**: Step 5 でエントリフォルダに移動するため、まず一時ファイルとして保存する
   - PowerShellでクリップボードから画像を取得・保存する:
     ```powershell
     Add-Type -AssemblyName System.Windows.Forms
     $img = [System.Windows.Forms.Clipboard]::GetImage()
     if ($img) { $img.Save("C:\work\2026\20260301_claude_skills_myTE\data\receipts\temp_{timestamp}.png") }
     ```
   - クリップボードに画像がない場合 → `image_path` を `"(要手動保存)"` として記録し、ユーザーに手動での保存を依頼する

#### パターンB: ファイルパスを指定

1. Readツールで画像ファイルを読み込みOCR処理する
2. 元ファイルパスを記録するのみ（コピーは Step 5 のエントリフォルダ作成時に行う）

#### 共通ルール

- エントリフォルダ（`data/pending/{folder}/`）の作成と画像の配置は **Step 5** で行う
- フォルダ内の画像ファイル名は `receipt.{元の拡張子}` に統一する

### Step 2: 画像OCR

Readツールで領収書画像を読み込み、以下の情報を抽出する:

- **日付**: `yyyy/mm/dd` 形式に変換
- **金額**: 税込金額（数値）
- **店舗名 / 事業者名**
- **登録番号**: インボイス番号（T + 13桁。例: `T1234567890123`）
- **消費税額・税率**: 記載がある場合
- **その他**: 乗車区間など
- **raw_text**: OCRで読み取った生テキスト全文（履歴に保存）

### Step 3: 領収書種別の推定

読み取り内容から以下のmyTEカテゴリに分類する:

| 読み取り内容 | myTEカテゴリ |
|---|---|
| タクシー会社 | `Travel - Taxi` |
| 電車・バス | `Travel - Public, Limo, & Other` |
| 新幹線 | `Travel - Rail` |
| 航空券 | `Travel - Air` |
| ホテル | `Accommodation - Hotel` |
| 飲食店 | `Meals and Entertainment` |
| 駐車場・高速・ガソリン | `Car Expense (Parking, Toll, Fuel)` |
| レンタカー | `Car Hire/Rental` |
| 通信費 | `Telecom/Internet` |
| その他 | `Other Expense` |

### Step 4: WBSコマンド解決

ユーザーの入力値を `.myte/wbs_mapping.json` で検索する。

1. `.myte/wbs_mapping.json` を読み込む
2. `command` が一致 & `is_active === true` のエントリを検索
3. 見つかった場合: 対応する `charge_code` を使用
4. 見つからない場合: 入力値が英数字5〜10文字ならCharge Codeとして直接使用
5. それ以外: ユーザーに再入力を依頼

### Step 5: エントリフォルダ作成

OCR結果（日付）とWBS解決（コード）が揃った段階で以下を実行する。

1. **フォルダ名の決定**: `{expense_yyyymmdd}-{wbs_code}`
   - Taxi: `on_date` の日付（例: `2026/03/01` → `20260301-CJDK4001`）
   - Hotel: `check_in_date` の日付（例: `2026/03/01` → `20260301-CJDK4001`）
   - 同名フォルダが `data/pending/` または `data/done/` に既存する場合: `-2`、`-3` を付与
2. **フォルダ作成**: `data/pending/{folder}/`
3. **画像配置**:
   - PatternA（一時保存済み）: 一時ファイルを `data/pending/{folder}/receipt.{ext}` に移動
   - PatternB（ファイルパス指定）: 元ファイルを `data/pending/{folder}/receipt.{ext}` にコピー
4. **entry.json 作成**: `data/pending/{folder}/entry.json` を Writeツールで作成（status: `ocr_completed`）
   - `id` フィールドはフォルダ名と同一（例: `20260301-CJDK4001`）

### Step 6: 不足情報の確認（AskUserQuestion を使用）

OCRで取得できなかった必須フィールドは `AskUserQuestion` ツールを使ってインタラクティブに収集する。

**"Other" が選択された場合のルール:**
- `answers[question]` が `"Other"` のとき、`annotations[question].notes` に入力されたテキストを実際の値として使用する
- notes が空の場合はユーザーに再入力を依頼する

---

#### Travel - Taxi の場合

OCR結果の概要をテキストで表示した後、**1回の AskUserQuestion** で不足する4フィールドをまとめて収集する。

```
AskUserQuestion({
  questions: [
    {
      question: "Reason（タクシー利用理由）を選択してください",
      header: "Reason",
      multiSelect: false,
      options: [
        { label: "Home <-> Client Site/Other Office", description: "自宅と客先/他オフィス間" },
        { label: "Home <-> Airport/Train",            description: "自宅と空港/駅間" },
        { label: "Client Site <-> Airport/Train",     description: "客先と空港/駅間" },
        { label: "Hotel <-> Airport/Train",           description: "ホテルと空港/駅間" }
      ]
      // "Other" は自動追加。選択時は notes に正確な値を入力してもらう
      // 全選択肢: Home<->Home Office / Home<->Client Site/Other Office /
      //   Client Site<->Client Site / Client Site<->Office /
      //   Office<->Office / Hotel<->Client Site/Other Office /
      //   Hotel<->Other Office / Other
    },
    {
      question: "Purpose（利用目的）を選択してください",
      header: "Purpose",
      multiSelect: false,
      options: [
        { label: "深夜勤務で交通手段が無い",           description: "深夜のため公共交通機関が利用不可" },
        { label: "公共の交通機関がタクシー以外にない", description: "公共交通機関が利用できないエリア" },
        { label: "緊急の為",                           description: "緊急事態のため" },
        { label: "資料・機材運搬の為",                 description: "荷物が多いため" }
      ]
    },
    {
      question: "出発地 (From Location) を入力してください",
      header: "From",
      multiSelect: false,
      options: [
        { label: "自宅",         description: "自宅から出発" },
        { label: "会社オフィス", description: "社内オフィスから出発" },
        { label: "客先オフィス", description: "客先オフィスから出発" },
        { label: "空港 / 駅",   description: "空港または駅から出発" }
      ]
      // "Other" を選択 → notes に具体的な場所名（例: 渋谷駅）を入力
    },
    {
      question: "到着地 (To Location) を入力してください",
      header: "To",
      multiSelect: false,
      options: [
        { label: "自宅",         description: "自宅に到着" },
        { label: "会社オフィス", description: "社内オフィスに到着" },
        { label: "客先オフィス", description: "客先オフィスに到着" },
        { label: "空港 / 駅",   description: "空港または駅に到着" }
      ]
      // "Other" を選択 → notes に具体的な場所名（例: 六本木オフィス）を入力
    }
  ]
})
```

回答を受け取ったら:
1. 各フィールドの値を確定する（"Other" の場合は `annotations[question].notes` を使用）
2. Step 7 へ進む

---

#### 必須フィールド一覧（Travel - Taxi）

| フィールド | 説明 | デフォルト値 |
|---|---|---|
| Charge Code | WBSコード | ※コマンドから解決 |
| Amount | 金額（税込） | ※OCRから取得 |
| Country/Region | 経費発生国 | Japan |
| Currency | 通貨 | JPY |
| On | 日付 | ※OCRから取得 |
| Reason | 理由（ドロップダウン） | ※AskUserQuestion |
| Purpose | 目的（ドロップダウン） | ※AskUserQuestion |
| Consumption Type | 消費税タイプ | Consumption Tax 10% |
| VAT Registered Number | 登録番号 | ※OCRから取得 |
| From Location | 出発地 | ※AskUserQuestion |
| To Location | 到着地 | ※AskUserQuestion |
| Comments | コメント（任意） | 空欄 |
| Public Official >$25 | 公務員提供チェック | false |

---

#### Accommodation - Hotel の場合

OCR結果の概要をテキストで表示した後、**1回の AskUserQuestion** で Hotel City を収集する。

```
AskUserQuestion({
  questions: [
    {
      question: "Hotel City（ホテル所在の市区町村）を選択または入力してください",
      header: "Hotel City",
      multiSelect: false,
      options: [
        { label: "東京都内", description: "例: 東京都千代田区" },
        { label: "大阪府内", description: "例: 大阪府大阪市" },
        { label: "愛知県内", description: "例: 愛知県名古屋市" },
        { label: "福岡県内", description: "例: 福岡県福岡市" }
      ]
      // "Other" を選択 → notes に正確な市区町村名（例: 東京都渋谷区）を入力
    }
  ]
})
```

回答を受け取ったら:
1. "Other" の場合は `annotations[question].notes` を hotel_city として使用
2. 都道府県名のみ選択された場合（例: "東京都内"）は、OCRで読み取ったホテル住所と照合して市区町村を補完する
3. Step 7 へ進む

---

#### 必須フィールド一覧（Accommodation - Hotel）

| フィールド | 説明 | デフォルト値 |
|---|---|---|
| Charge Code | WBSコード | ※コマンドから解決 |
| Amount | 金額（税込合計） | ※OCRから取得 |
| Country/Region | 経費発生国 | Japan |
| Currency | 通貨 | JPY |
| Check-in | チェックイン日 | ※OCRから取得 |
| Check-out | チェックアウト日 | ※OCRから取得 |
| Hotel Name | ホテル名 | ※OCRから取得 |
| Hotel City | ホテル所在地（市区町村） | ※AskUserQuestion |
| Consumption Type | 消費税タイプ | Consumption Tax 10% |
| VAT Registered Number | 登録番号 | ※OCRから取得 |
| Comments | コメント（任意） | 空欄 |
| Public Official >$25 | 公務員提供チェック | false |

**ホテル領収書からの追加抽出項目:**
- チェックイン日・チェックアウト日（宿泊期間）
- 宿泊数
- 1泊あたりの料金（記載がある場合）
- ホテル名（正式名称）
- ホテル住所（Hotel City の補完に使用）

---

#### Consumption Type の選択肢（共通）

- No Consumption Tax
- Consumption Tax 8%
- Consumption Tax 10%

### Step 7: ユーザー確認完了後

`data/pending/{folder}/entry.json` の status を `confirmed` に更新し、確定した `myte_fields` を記録する（Editツール使用）。

### Step 8: 出力

全フィールドが確定したら以下のJSON形式で出力する。

**Travel - Taxi の場合:**
```json
{
  "history_id": "20260301-CJDK4001",
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

**Accommodation - Hotel の場合:**
```json
{
  "history_id": "20260301-CJDK4001",
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

## ユーザーへの表示フォーマット

### Travel - Taxi の場合

Step 5 完了後、まず OCR 結果をテキストで表示し、続けて AskUserQuestion を呼び出す。

**テキスト表示（AskUserQuestion 呼び出し前）:**
```
領収書読み取り結果（ID: 20260301-CJDK4001）

種別: Travel - Taxi（タクシー）
日付: 2026/03/01
金額: ¥3,500
店舗名: ○○タクシー
登録番号: T1234567890123
保存先: data/pending/20260301-CJDK4001/receipt.jpg

続けて不足情報を確認します。
```

**その後すぐに AskUserQuestion を呼び出す。**（Step 6 の Taxi 用クエリを参照）

### Accommodation - Hotel の場合

Step 5 完了後、まず OCR 結果をテキストで表示し、続けて AskUserQuestion を呼び出す。

**テキスト表示（AskUserQuestion 呼び出し前）:**
```
領収書読み取り結果（ID: 20260301-CJDK4001）

種別: Accommodation - Hotel（ホテル）
チェックイン: 2026/03/01
チェックアウト: 2026/03/02
金額: ¥12,000
ホテル名: 東横イン渋谷
登録番号: T9876543210123
保存先: data/pending/20260301-CJDK4001/receipt.jpg

続けて不足情報を確認します。
```

**その後すぐに AskUserQuestion を呼び出す。**（Step 6 の Hotel 用クエリを参照）

## 履歴参照コマンド

- 「OCR履歴」「履歴一覧」: `data/pending/*/entry.json` + `data/done/*/entry.json` を glob して一覧をテーブル表示
- 「履歴検索 {日付}」: 特定日付のエントリを表示
- 「履歴詳細 {id}」: `data/pending/{id}/entry.json` または `data/done/{id}/entry.json` を直接読み込み表示

## エントリJSONの構造（data/pending/{yyyymmdd-WBS}/entry.json）

- `data/pending/{folder}/` : status が `ocr_completed` または `confirmed` または `failed` のエントリ
- `data/done/{folder}/`    : status が `submitted` のエントリ
- 各フォルダには `entry.json` と `receipt.{ext}` が格納される

```json
{
  "id": "20260301-CJDK4001",
  "timestamp": "2026-03-01T10:30:00+09:00",
  "image_path": "data/pending/20260301-CJDK4001/receipt.jpg",
  "expense_type": "Travel - Taxi",
  "ocr_result": {
    "date": "2026/03/01",
    "amount": 3500,
    "vendor_name": "○○タクシー",
    "registration_number": "T1234567890123",
    "tax_amount": 318,
    "tax_rate": "10%",
    "raw_text": "OCRで読み取った生テキスト全文"
  },
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
  },
  "status": "ocr_completed | confirmed | submitted | failed",
  "wbs_command_used": "sb"
}
```

### status の値

| status | 説明 |
|---|---|
| `ocr_completed` | OCR読み取り完了、ユーザー確認待ち |
| `confirmed` | ユーザーがフィールド確認済み、myTE入力待ち |
| `submitted` | myTEへの入力完了（Save済み） |
| `failed` | エラーにより中断 |

## Step 9: myTE登録Skillの自動呼び出し

Step 8 の出力が確定したら、`expense_type` に応じて対応するmyTE登録Skillを **Skillツールで自動呼び出し** する。

### ディスパッチルール

| expense_type | 呼び出すSkill | Skillツール引数 |
|---|---|---|
| `Travel - Taxi` | Skill C | `skill: "skill-c-myte-taxi-entry"` |
| `Accommodation - Hotel` | Skill D | `skill: "skill-d-myte-hotel-entry"` |
| 上記以外 | なし（ユーザーに選択させる） | — |

### 対応Skillが存在する場合

自動で Skill ツールを呼び出す:
```
Skill({ skill: "skill-c-myte-taxi-entry" })
```
呼び出し時、確定済みの entry.json のパス（`data/pending/{folder}/entry.json`）を引数として渡す。

### 対応Skillが存在しない場合

expense_type が Taxi / Hotel 以外の場合、AskUserQuestion でユーザーに選択させる:

```
AskUserQuestion({
  questions: [
    {
      question: "この経費種別（{expense_type}）の自動入力Skillがありません。どうしますか？",
      header: "次のアクション",
      multiSelect: false,
      options: [
        { label: "手動でmyTEに入力する", description: "entry.jsonの内容を参考に手動入力。完了後にステータスを更新" },
        { label: "Taxiとして登録", description: "Skill C（Travel - Taxi）で登録を試みる" },
        { label: "Hotelとして登録", description: "Skill D（Accommodation - Hotel）で登録を試みる" },
        { label: "スキップ", description: "今は登録せず、後で対応する" }
      ]
    }
  ]
})
```

- 「手動でmyTEに入力する」→ ユーザーがSave完了報告後にstatusを `submitted` に更新
- 「Taxiとして登録」→ Skill C を呼び出し
- 「Hotelとして登録」→ Skill D を呼び出し
- 「スキップ」→ statusは `confirmed` のまま。後で「履歴詳細 {id}」から再開可能

## 注意事項

- OCR精度が低い項目は必ずユーザーに確認する
- 金額は税込金額をAmountに設定する
- 複数枚の領収書は1枚ずつ処理する
- 登録番号が読み取れない場合はユーザーに手動入力を依頼する
- エントリフォルダ（`data/pending/{yyyymmdd-WBS}/`）が存在しない場合は自動作成する
