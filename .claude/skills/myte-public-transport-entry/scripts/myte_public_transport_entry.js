/**
 * myTE Travel - Public, Limo, & Other 経費自動入力スクリプト
 * 公共交通機関（電車・バス等）の通勤交通費をmyTEに自動入力する。
 * OCR/画像添付は不要。entry.json の myte_fields を直接使用する。
 *
 * 使い方:
 *   node myte_public_transport_entry.js <entryId>
 *   例: node myte_public_transport_entry.js 20260216-CJDK4001
 *
 * entry.json の myte_fields に必要なフィールド:
 *   charge_code, from_date, to_date, reason, type, trip_no, one_trip_amount,
 *   consumption_type, from_location, to_location
 *   (任意: qualified_invoice, vat_registered_number, comments, public_official_above_25)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = 'C:\\work\\2026\\20260301_claude_skills_myTE';
const PENDING_DIR = path.join(PROJECT_ROOT, 'data', 'pending');
const DONE_DIR = path.join(PROJECT_ROOT, 'data', 'done');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'data', 'screenshots');

const entryId = process.argv[2];
if (!entryId) {
  console.error('使い方: node myte_public_transport_entry.js <entryId>');
  console.error('例: node myte_public_transport_entry.js 20260216-CJDK4001');
  process.exit(1);
}

const entryJsonPath = path.join(PENDING_DIR, entryId, 'entry.json');
if (!fs.existsSync(entryJsonPath)) {
  console.error(`entry.json が見つかりません: ${entryJsonPath}`);
  process.exit(1);
}
const historyEntry = JSON.parse(fs.readFileSync(entryJsonPath, 'utf-8'));
const data = {
  history_id: historyEntry.entry_id || entryId,
  expense_type: historyEntry.expense_type,
  myte_fields: historyEntry.myte_fields,
};

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------
function updateHistoryStatus(historyId, status) {
  const pendingFolderPath = path.join(PENDING_DIR, historyId);
  const doneFolderPath = path.join(DONE_DIR, historyId);
  const entryPath = path.join(pendingFolderPath, 'entry.json');
  const entry = JSON.parse(fs.readFileSync(entryPath, 'utf-8'));
  entry.status = status;
  if (status === 'submitted') {
    if (entry.image_path) {
      entry.image_path = entry.image_path.replace(/^data\/pending\//, 'data/done/');
    }
    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2), 'utf-8');
    fs.mkdirSync(DONE_DIR, { recursive: true });
    if (fs.existsSync(doneFolderPath)) {
      fs.rmSync(doneFolderPath, { recursive: true, force: true });
    }
    fs.renameSync(pendingFolderPath, doneFolderPath);
  } else {
    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2), 'utf-8');
  }
  console.log(`  履歴ステータス → ${status}`);
}

async function saveScreenshot(page, name) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath });
  console.log(`  スクリーンショット: ${filePath}`);
}

// ---------------------------------------------------------------------------
// Charge Code 選択（ag-grid コンボボックス）
// ---------------------------------------------------------------------------
async function selectChargeCode(page, wbsCode) {
  let combobox = page.locator("div.myte-charge-code-field[role='combobox']").first();
  if ((await combobox.count()) === 0 || !(await combobox.isVisible())) {
    combobox = page.locator("[aria-label='Select a Charge Code']").first();
  }
  if ((await combobox.count()) === 0) {
    await saveScreenshot(page, '04_charge_code_field_not_found');
    console.error('  Charge Code フィールドが見つかりません');
    return false;
  }

  await combobox.click();
  await page.waitForTimeout(1000);

  const filterInput = page.locator("input#filter-text, input[placeholder='Filter...']").first();
  if ((await filterInput.count()) === 0 || !(await filterInput.isVisible())) {
    console.error('  Charge Code フィルター入力が見つかりません');
    return false;
  }

  await filterInput.click();
  await filterInput.press('Control+a');
  await filterInput.press('Delete');
  await filterInput.pressSequentially(wbsCode, { delay: 80 });
  await page.evaluate(() => {
    const el = document.querySelector('input#filter-text') || document.querySelector('input[placeholder="Filter..."]');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('keyup', { bubbles: true }));
    }
  });
  await page.waitForTimeout(2000);

  const candidates = [
    page.locator(`div[col-id='key']:has-text('${wbsCode}')`).first(),
    page.locator(`div.ag-row:not(.error-cell) div[col-id='key']:has-text('${wbsCode}')`).first(),
    page.locator(`div.ag-row:has-text('${wbsCode}')`).first(),
  ];
  for (const loc of candidates) {
    try {
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        await loc.click();
        console.log(`  Charge Code → '${wbsCode}' を選択しました`);
        await page.waitForTimeout(1000);
        return true;
      }
    } catch (e) { continue; }
  }

  await saveScreenshot(page, '04c_charge_code_option_not_found');
  console.error('  警告: Charge Code 候補が見つかりませんでした');
  return false;
}

// ---------------------------------------------------------------------------
// ドロップダウン選択（Angular カスタム combobox）
// ---------------------------------------------------------------------------
async function selectDropdown(page, labelText, optionText) {
  const harrVersion = optionText.replace('<->', '\u2194');
  const normalizedVersion = optionText.replace('\u2194', '<->');
  const candidates = [...new Set([harrVersion, optionText, normalizedVersion])];

  await page.waitForTimeout(500);

  // ネイティブ <select>
  try {
    const selectId = await page.evaluate((lbl) => {
      for (const el of document.querySelectorAll('label')) {
        if (el.textContent.trim().replace(/\*/g, '').trim().toLowerCase().includes(lbl.toLowerCase())) {
          const forId = el.getAttribute('for');
          if (forId) {
            const sel = document.getElementById(forId);
            if (sel && sel.tagName === 'SELECT') return forId;
          }
        }
      }
      return null;
    }, labelText);
    if (selectId) {
      const sel = page.locator(`#${selectId}`);
      for (const val of candidates) {
        try { await sel.selectOption({ label: val }); console.log(`  '${labelText}' → '${val}'`); return true; } catch {}
      }
    }
  } catch {}

  // Angular カスタム combobox
  try {
    const combobox = page.locator(`div[role='combobox'][aria-label*='${labelText}' i]`).first();
    if ((await combobox.count()) === 0) return false;

    let trigger = combobox.locator('div.item.active').first();
    if ((await trigger.count()) === 0) trigger = combobox;

    await trigger.click();
    await page.waitForTimeout(1500);

    const openUl = combobox.locator('ul.select-items:not(.select-hide)').first();
    let dropdownConfirmed = false;
    try { await openUl.waitFor({ state: 'visible', timeout: 1500 }); dropdownConfirmed = true; } catch {}

    const firstTimeout = dropdownConfirmed ? 3000 : 800;
    for (const name of candidates) {
      try {
        await page.getByRole('option', { name, exact: true }).click({ timeout: firstTimeout });
        console.log(`  '${labelText}' → '${name}' を選択しました`);
        await page.waitForTimeout(500);
        return true;
      } catch {}
    }

    if (!dropdownConfirmed) {
      await trigger.click();
      await page.waitForTimeout(1500);
      for (const name of candidates) {
        try {
          await page.getByRole('option', { name, exact: true }).click({ timeout: 3000 });
          console.log(`  '${labelText}' → '${name}' を選択しました（再試行）`);
          await page.waitForTimeout(500);
          return true;
        } catch {}
      }
    }

    const parts = optionText.split(/↔|<->/).map(s => s.trim()).filter(Boolean);
    const searchText = parts[parts.length - 1] || optionText;
    for (const ulSel of ['ul.select-items:not(.select-hide) li', 'ul.select-items li']) {
      try {
        await page.locator(ulSel).filter({ hasText: searchText }).first().click({ timeout: 2000 });
        console.log(`  '${labelText}' → (partial '${searchText}') を選択しました`);
        await page.waitForTimeout(500);
        return true;
      } catch {}
    }
  } catch (e) {
    console.error(`  [combobox] error: ${e.message}`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// テキスト入力
// ---------------------------------------------------------------------------
async function fillInput(page, selector, value, label) {
  await page.waitForTimeout(300);
  for (const sel of (Array.isArray(selector) ? selector : [selector])) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.click();
        await el.press('Control+a');
        await el.pressSequentially(String(value), { delay: 50 });
        console.log(`  ${label} = '${value}' を入力しました`);
        return true;
      }
    } catch {}
  }
  console.error(`  警告: ${label} のフィールドが見つかりませんでした`);
  return false;
}

async function fillByLabel(page, labelText, value) {
  await page.waitForTimeout(300);
  try {
    const forId = await page.evaluate((lbl) => {
      for (const el of document.querySelectorAll('label')) {
        if (el.textContent.trim().replace(/\*/g, '').trim().toLowerCase().includes(lbl.toLowerCase())) {
          return el.getAttribute('for');
        }
      }
      return null;
    }, labelText);
    if (forId) {
      const el = page.locator(`#${CSS.escape(forId)}`);
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.clear();
        await el.fill(value);
        console.log(`  '${labelText}' = '${value}' を入力しました`);
        return true;
      }
    }
  } catch {}
  for (const sel of [
    `input[aria-label*='${labelText}' i]`,
    `input[placeholder*='${labelText}' i]`,
  ]) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.clear();
        await el.fill(value);
        console.log(`  '${labelText}' = '${value}' を入力しました`);
        return true;
      }
    } catch {}
  }
  return false;
}

// ---------------------------------------------------------------------------
// 日付入力 (yyyy/mm/dd → m/d/yyyy に変換)
// ---------------------------------------------------------------------------
async function fillDate(page, selectors, dateStr, label) {
  const parts = dateStr.split('/');
  const dateForInput = parts.length === 3
    ? `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[0]}`
    : dateStr;

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        // fill() で値をセットし、input/change イベントを発火
        await el.fill(dateForInput);
        await page.waitForTimeout(300);
        // Angular の変更検知を確実にトリガーするため blur イベントも発火
        await el.dispatchEvent('input');
        await el.dispatchEvent('change');
        await el.dispatchEvent('blur');
        await page.waitForTimeout(500);
        console.log(`  ${label} = ${dateForInput} を入力しました`);
        return true;
      }
    } catch {}
  }
  console.error(`  警告: ${label} のフィールドが見つかりませんでした`);
  return false;
}

// ---------------------------------------------------------------------------
// メイン処理
// 注意: 前回ピリオドの取得は get_previous_period.js で事前に実行済み。
// このスクリプトは entry.json の情報をもとにフォーム入力のみ行う。
// ---------------------------------------------------------------------------
(async () => {
  const userDataDir = path.join(PROJECT_ROOT, '.myte', 'browser-data');
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

  // about:blank タブを閉じる（persistent context は起動のたびに追加するため）
  const allPages = browser.pages();
  for (const p of allPages) {
    if (p.url() === 'about:blank' && allPages.length > 1) {
      await p.close();
    }
  }
  const page = browser.pages()[0] || await browser.newPage();

  try {
    const f = data.myte_fields;

    // [1] ページアクセス
    console.log('[1] myTEにアクセス中...');
    await page.goto('https://myte.accenture.com/#/time', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // SSOセッション確認
    try {
      await page.waitForSelector('text=EXPENSES', { timeout: 15000 });
    } catch {
      console.log('  SSOログインが必要です。ブラウザでログインしてください...');
      await page.waitForURL('**/myte.accenture.com/**', { timeout: 120000 });
      await page.waitForSelector('text=EXPENSES', { timeout: 30000 });
    }
    await saveScreenshot(page, '01_initial');

    // [2] EXPENSESタブ
    console.log('[2] EXPENSESタブをクリック...');
    await page.locator('text=EXPENSES').first().click();
    await page.waitForTimeout(3000);
    await saveScreenshot(page, '02_expenses_tab');

    // [3] Travel - Public, Limo, & Other を選択
    console.log('[3] Travel - Public, Limo, & Other を選択...');

    // 方法1: #comboboxselect-expense-dropdown を試す
    let expenseSelected = false;
    try {
      const combobox = page.locator('#comboboxselect-expense-dropdown').first();
      if ((await combobox.count()) > 0 && (await combobox.isVisible())) {
        await combobox.click();
        await page.waitForTimeout(1500);
        const travelOption = page.locator('li[aria-label*="Travel - Public"]').first();
        if ((await travelOption.count()) > 0) {
          await travelOption.click();
          expenseSelected = true;
          console.log('  Travel - Public, Limo, & Other を選択しました（combobox）');
        }
      }
    } catch {}

    // 方法2: ネイティブ select を試す
    if (!expenseSelected) {
      try {
        const nativeSelect = page.locator('select').first();
        if ((await nativeSelect.count()) > 0 && (await nativeSelect.isVisible())) {
          await nativeSelect.selectOption({ label: 'Travel - Public, Limo, & Other' });
          expenseSelected = true;
          console.log('  Travel - Public, Limo, & Other を選択しました（native select）');
        }
      } catch {}
    }

    // 方法3: "Select Expenses to Add" テキストを持つ要素を探す
    if (!expenseSelected) {
      try {
        const selectExpenses = page.locator('div.item.active, div[role="combobox"], button, div.dropdown').filter({ hasText: /Select Expenses/i }).first();
        if ((await selectExpenses.count()) > 0 && (await selectExpenses.isVisible())) {
          await selectExpenses.click();
          await page.waitForTimeout(2000);
          for (const loc of [
            page.locator('li[aria-label*="Travel - Public"]').first(),
            page.getByText('Travel - Public, Limo, & Other', { exact: false }).first(),
            page.locator("li:has-text('Travel - Public')").first(),
          ]) {
            try {
              if ((await loc.count()) > 0 && (await loc.isVisible())) {
                await loc.click();
                expenseSelected = true;
                console.log('  Travel - Public, Limo, & Other を選択しました');
                break;
              }
            } catch {}
          }
        }
      } catch {}
    }

    if (!expenseSelected) {
      await saveScreenshot(page, '03_expense_select_failed');
      throw new Error('Travel - Public, Limo, & Other の選択に失敗しました。EXPENSESタブのUIを確認してください。');
    }

    // フォーム読み込み待機
    console.log('  フォームの読み込みを待機中...');
    await page.waitForSelector(
      "div.myte-charge-code-field, [aria-label='Select a Charge Code']",
      { timeout: 30000 }
    );
    await page.waitForTimeout(1000);
    await saveScreenshot(page, '03_form_appeared');

    // [4] Charge Code
    console.log(`[4] Charge Code「${f.charge_code}」を選択...`);
    if (!await selectChargeCode(page, f.charge_code)) {
      console.error('  警告: Charge Code の自動選択に失敗しました。手動で選択してください。');
    }

    // [5] From (開始日)
    console.log(`[5] From「${f.from_date}」を入力...`);
    await fillDate(page, [
      '[id="from_input"]',
      "input[aria-label='From']",
      "input[placeholder*='yyyy']",
    ], f.from_date, 'From');

    // [6] To (終了日)
    console.log(`[6] To「${f.to_date}」を入力...`);
    await fillDate(page, [
      '[id="to_input"]',
      "input[aria-label='To']",
    ], f.to_date, 'To');
    await page.waitForTimeout(500);

    // [7] Reason
    console.log(`[7] Reason「${f.reason}」を選択...`);
    if (!await selectDropdown(page, 'Reason', f.reason)) {
      await saveScreenshot(page, '07_reason_failed');
      console.error('  警告: Reason の自動選択に失敗しました。手動で選択してください。');
    }

    // [8] Type
    console.log(`[8] Type「${f.type}」を選択...`);
    if (!await selectDropdown(page, 'Type', f.type)) {
      console.error('  警告: Type の自動選択に失敗しました。手動で選択してください。');
    }

    // [9] Trip No.
    console.log(`[9] Trip No.「${f.trip_no}」を入力...`);
    await fillInput(page, [
      '[id="trip no._input"]',
      "input[aria-label='Trip No.']",
      "input[aria-label*='Trip']",
    ], f.trip_no, 'Trip No.');

    // [10] One Trip Amount
    console.log(`[10] One Trip Amount「${f.one_trip_amount}」を入力...`);
    await fillInput(page, [
      '[id="one trip amount_input"]',
      "input[aria-label='One Trip Amount']",
      "input[aria-label*='One Trip']",
    ], f.one_trip_amount, 'One Trip Amount');

    // [11] Consumption Type
    console.log(`[11] Consumption Type「${f.consumption_type}」を選択...`);
    await selectDropdown(page, 'Consumption Type', f.consumption_type);

    // [12] Qualified Invoice
    if (f.qualified_invoice) {
      console.log('[12] Qualified Invoice をチェック...');
      try {
        const checkbox = page.locator("[aria-label*='Qualified Invoice'] input[type='checkbox'], [aria-label*='Qualified Invoice']").first();
        if ((await checkbox.count()) > 0) {
          const isChecked = await checkbox.isChecked().catch(() => false);
          if (!isChecked) {
            await checkbox.click();
            console.log('  Qualified Invoice をチェックしました');
          }
        }
      } catch (e) {
        console.error(`  警告: Qualified Invoice チェック失敗: ${e.message}`);
      }
    }

    // [13] VAT Registered Number
    if (f.vat_registered_number) {
      console.log(`[13] VAT Registered Number「${f.vat_registered_number}」を入力...`);
      await fillInput(page, [
        '[id="vat registered number_input"]',
        "input[aria-label='VAT Registered Number']",
      ], f.vat_registered_number, 'VAT Registered Number');
    }

    // [14] From Location
    console.log(`[14] From Location「${f.from_location}」を入力...`);
    await fillInput(page, [
      '[id="from location_input"]',
      "input[aria-label='From Location']",
    ], f.from_location, 'From Location');

    // [15] To Location
    console.log(`[15] To Location「${f.to_location}」を入力...`);
    await fillInput(page, [
      '[id="to location_input"]',
      "input[aria-label='To Location']",
    ], f.to_location, 'To Location');

    // [16] Comments
    if (f.comments) {
      console.log('[16] Comments を入力...');
      try {
        const textarea = page.locator('#comments_input, textarea').first();
        if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
          await textarea.fill(f.comments.slice(0, 200));
          console.log('  Comments を入力しました');
        }
      } catch {}
    }

    await saveScreenshot(page, '05_form_filled');
    console.log('\n✅ 全フィールドの入力が完了しました。');
    console.log(`  Charge Code: ${f.charge_code}`);
    console.log(`  期間: ${f.from_date} → ${f.to_date}`);
    console.log(`  Type: ${f.type}`);
    console.log(`  Trip: ${f.trip_no} × ¥${f.one_trip_amount}`);
    console.log(`  ${f.from_location} → ${f.to_location}`);
    console.log(`\nスクリーンショット: ${SCREENSHOT_DIR}`);
    console.log('\nブラウザで内容を確認し、問題なければ「Save」ボタンを押してください。');
    console.log('Save完了後にブラウザを閉じると、ステータスが submitted に更新されます。');

    // ユーザーがブラウザを閉じるまで待機
    await new Promise(resolve => {
      browser.on('close', resolve);
    });

    updateHistoryStatus(data.history_id, 'submitted');
    console.log('\n✅ 完了しました（ID:', data.history_id, '）');

  } catch (err) {
    console.error('\n❌ エラーが発生しました:', err.message);
    await saveScreenshot(page, 'error').catch(() => {});
    updateHistoryStatus(data.history_id, 'failed');
    process.exit(1);
  }
})();
