# Skill B: WBSコマンドマッピング管理

## 概要

WBSコード（Charge Code）とユーザー定義ショートコマンドの対応表をJSONファイルで管理する。他のスキル（Skill A等）からコマンド解決ロジックとして参照される。

## データファイル

パス: `.myte/wbs_mapping.json`（プロジェクトルートからの相対パス）

### データ構造

```json
{
  "version": "1.0",
  "updated_at": "2026-03-01T12:00:00+09:00",
  "mappings": [
    {
      "command": "sb",
      "charge_code": "CJDK4001",
      "description": "B2B-CustomerSuccess_CRMDevAM_Mar24-Mar25",
      "created_at": "2026-03-01T12:00:00+09:00"
    }
  ]
}
```

## トリガーと対応コマンド

### 1. 登録（新規追加）

**トリガー**: 「WBS登録」「WBS追加」「add wbs」

**処理フロー**:
1. ショートコマンド名を聞く（英数字・日本語、1〜10文字）
2. WBSコード（Charge Code）を聞く
3. 任意で説明（description）、クライアント名を聞く
4. 既存コマンドとの重複チェック
5. JSONファイルに追記・保存（`updated_at` も更新）
6. **myTEにCharge Codeを登録する**（後述の「myTE Charge Code 登録」参照）

**出力**:
```
✅ WBSマッピングを登録しました
コマンド: sb → Charge Code: CJDK4001（Softbank Corp.）
myTEにもCharge Codeを登録しました。
```

#### myTE Charge Code 登録

WBS登録時に、Charge Code を myTE にも自動登録する。

**実行スクリプト**: `.claude/skills/wbs-management/scripts/myte_add_chargecode.js`

**実行コマンド**:
```bash
node .claude/skills/wbs-management/scripts/myte_add_chargecode.js {charge_code}
```

**スクリプトの処理内容**:
1. 永続コンテキスト（`.myte/browser-data/`）でブラウザを起動
2. `https://myte.accenture.com/#/time` にアクセス
3. 「CHARGE CODE」タブを開く
4. 「Enter Charge Code」入力欄に Charge Code を入力
5. 「Add」ボタンを押す
6. ブラウザを閉じる

**SSOセッション切れの自動対処**:
スクリプト内でSSO切れを検出した場合、自動で `セッション保存.bat` を別ウィンドウで起動し、ユーザーがSSO認証を完了後にリトライする（1回まで）。

**exit code**:
- `0`: 成功
- `2`: セッション更新後もSSO認証に失敗
- `3`: その他エラー（セレクター不一致等）→ エラー内容をユーザーに報告し、手動登録を案内

### 2. 一覧表示

**トリガー**: 「WBS一覧」「WBSリスト」「list wbs」

**処理**: JSONを読み込み、テーブル形式で表示

**出力**:
```
📋 WBSマッピング一覧（全X件）
| # | コマンド | Charge Code | 説明 | クライアント | 状態 |
|---|---------|-------------|------|-------------|------|
| 1 | sb      | CJDK4001    | B2B-CustomerSuccess... | Softbank Corp. | ✅ |
| 2 | aflac   | BDBNM00C    | Aflac BPO Osaka...     | Aflac Life Ins | ✅ |
```

### 3. 更新

**トリガー**: 「WBS更新」「WBS変更」「update wbs」

**処理フロー**:
1. 対象コマンドを聞く
2. 変更項目を確認
3. 変更前後を表示
4. 確認後にJSONファイルを保存（`updated_at` も更新）

### 4. 削除

**トリガー**: 「WBS削除」「delete wbs」

**処理フロー**:
1. 対象コマンドを確認
2. ソフトデリート（`is_active=false`）または物理削除を選択
3. 確認後にJSONファイルを保存（`updated_at` も更新）

## コマンド解決ロジック（他Skillからの参照用）

他のスキル（特にSkill A）からWBSコマンドを解決する際は、以下のロジックに従う:

1. `.myte/wbs_mapping.json` を読み込む
2. `command` が一致 & `is_active === true` のエントリを検索
3. **見つかった場合**: `charge_code` を返却
4. **見つからない場合**: 入力値が英数字5〜10文字ならCharge Codeとして直接使用
5. **それ以外**: ユーザーに再入力を依頼

## バリデーションルール

| 項目 | ルール |
|---|---|
| コマンド名 | 英数字・日本語（ひらがな・カタカナ・漢字）、1〜10文字、重複不可、英字はlowercase保存 |
| Charge Code | 英数字、5〜10文字 |
| description | 任意、最大100文字 |
| 登録上限 | 最大50件まで |

### JSONファイルが存在しない場合

初期テンプレートで新規作成する:

```json
{
  "version": "1.0",
  "updated_at": "",
  "mappings": []
}
```

## 注意事項

- コマンド名の英字部分は常にlowercaseで保存・検索する（日本語はそのまま保存）
- `is_active` が `false` のエントリはコマンド解決時に無視される
- 一覧表示では `is_active` が `false` のエントリも表示する（状態欄に ❌ を表示）
- JSONファイルの読み書き時は必ず `updated_at` を現在のISO 8601形式（JST）で更新する
