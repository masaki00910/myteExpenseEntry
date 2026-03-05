# Project Rules

## Playwright スクリプト実行ルール

myTE経費登録（Taxi, Hotel, Public Transport）のPlaywright操作は、**必ず各スキル配下の既存スクリプトを `node` コマンドで実行すること**。

- Taxi: `node .claude/skills/myte-taxi-entry/scripts/myte_taxi_entry.js`
- Hotel: `node .claude/skills/myte-hotel-entry/scripts/myte_hotel_entry.js`
- Public Transport: `node .claude/skills/myte-public-transport-entry/scripts/myte_public_transport_entry.js <entryId>`
- 前回ピリオド取得: `node .claude/skills/myte-public-transport-entry/scripts/get_previous_period.js`
- WBS登録: `node .claude/skills/wbs-management/scripts/myte_add_chargecode.js <charge_code>`

**禁止事項:**
- 一時ファイル（temp file）にPlaywrightコードをハードコーディングして実行すること
- SKILL.md内のコード例をコピーして新規スクリプトを作成すること
- 既存スクリプトの処理を別ファイルで再実装すること
