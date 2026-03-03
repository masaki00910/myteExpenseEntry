const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = 'C:\\work\\2026\\20260301_claude_skills_myTE';
const PENDING_DIR = path.join(PROJECT_ROOT, 'data', 'pending');
const DONE_DIR = path.join(PROJECT_ROOT, 'data', 'done');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'data', 'screenshots');

// エントリIDをCLI引数から取得（例: node myte_taxi_entry.js 20231225-A302005）
const entryId = process.argv[2];
if (!entryId) {
  console.error('使い方: node myte_taxi_entry.js <entryId>');
  console.error('例: node myte_taxi_entry.js 20231225-A302005');
  process.exit(1);
}

// entry.json から全データを読み込む
const entryJsonPath = path.join(PENDING_DIR, entryId, 'entry.json');
if (!fs.existsSync(entryJsonPath)) {
  console.error(`entry.json が見つかりません: ${entryJsonPath}`);
  process.exit(1);
}
const historyEntry = JSON.parse(fs.readFileSync(entryJsonPath, 'utf-8'));
const IMAGE_PATH = historyEntry.image_path
  ? path.resolve(PROJECT_ROOT, historyEntry.image_path)
  : null;

const data = {
  history_id: historyEntry.id,
  expense_type: historyEntry.expense_type,
  myte_fields: historyEntry.myte_fields
};

function updateHistoryStatus(historyId, status) {
  const pendingFolderPath = path.join(PENDING_DIR, historyId);
  const doneFolderPath = path.join(DONE_DIR, historyId);
  const entryPath = path.join(pendingFolderPath, 'entry.json');
  const entry = JSON.parse(fs.readFileSync(entryPath, 'utf-8'));
  entry.status = status;
  if (status === 'submitted') {
    entry.image_path = entry.image_path.replace(/^data\/pending\//, 'data/done/');
    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2), 'utf-8');
    fs.mkdirSync(DONE_DIR, { recursive: true });
    // 既存の done フォルダがあれば削除してから rename
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
  // Step1: コンボボックスを展開
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
  await saveScreenshot(page, '04a_charge_code_expanded');

  // Step2: Filter入力欄にWBSコードを入力
  const filterInput = page.locator("input#filter-text, input[placeholder='Filter...']").first();
  if ((await filterInput.count()) === 0 || !(await filterInput.isVisible())) {
    console.error('  Charge Code フィルター入力が見つかりません');
    return false;
  }

  await filterInput.click();
  await filterInput.press('Control+a');
  await filterInput.press('Delete');
  await filterInput.pressSequentially(wbsCode, { delay: 80 });
  // Angularのフィルターイベントを明示的に発火
  await page.evaluate(() => {
    const el = document.querySelector('input#filter-text') || document.querySelector('input[placeholder="Filter..."]');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('keyup', { bubbles: true }));
    }
  });
  await page.waitForTimeout(2000);
  await saveScreenshot(page, '04b_charge_code_typed');

  // Step3: 絞り込まれた ag-grid 行をクリック
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
  // ↔ / <-> を両方試す
  const harrVersion = optionText.replace('<->', '\u2194');
  const normalizedVersion = optionText.replace('\u2194', '<->');
  const candidates = [...new Set([harrVersion, optionText, normalizedVersion])];

  await page.waitForTimeout(500);

  // --- 1. ネイティブ <select> を試みる ---
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
        try { await sel.selectOption({ label: val }); console.log(`  '${labelText}' → '${val}' (native select)`); return true; } catch {}
        try { await sel.selectOption({ value: val }); console.log(`  '${labelText}' → '${val}' (native select value)`); return true; } catch {}
      }
    }
  } catch {}

  // --- 2. Angular カスタム combobox ---
  try {
    const combobox = page.locator(`div[role='combobox'][aria-label*='${labelText}' i]`).first();
    if ((await combobox.count()) === 0) return false;

    let trigger = combobox.locator('div.item.active').first();
    if ((await trigger.count()) === 0) trigger = combobox;

    await trigger.click();
    await page.waitForTimeout(1500);

    // ドロップダウンが開いたか確認
    const openUl = combobox.locator('ul.select-items:not(.select-hide)').first();
    let dropdownConfirmed = false;
    try {
      await openUl.waitFor({ state: 'visible', timeout: 1500 });
      dropdownConfirmed = true;
    } catch {}

    const firstTimeout = dropdownConfirmed ? 3000 : 800;
    for (const name of candidates) {
      try {
        await page.getByRole('option', { name, exact: true }).click({ timeout: firstTimeout });
        console.log(`  '${labelText}' → '${name}' を選択しました`);
        await page.waitForTimeout(500);
        return true;
      } catch {}
    }

    // 再クリックして再試行
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

    // 部分テキストフォールバック
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
// テキスト入力（ラベルベース）
// ---------------------------------------------------------------------------
async function fillByLabel(page, labelText, value) {
  await page.waitForTimeout(300);
  // label[for] で特定
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
      const el = page.locator(`#${forId}`);
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.clear();
        await el.fill(value);
        console.log(`  '${labelText}' = '${value}' を入力しました`);
        return true;
      }
    }
  } catch {}
  // aria-label / placeholder フォールバック
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
// メイン処理
// ---------------------------------------------------------------------------
(async () => {
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
    await page.waitForSelector('div.item.active', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await saveScreenshot(page, '02_expenses_tab');

    // [3] Travel - Taxi を選択
    console.log('[3] Travel - Taxiを選択...');
    const nativeSelect = page.locator('select').first();
    if ((await nativeSelect.count()) > 0 && (await nativeSelect.isVisible())) {
      await nativeSelect.selectOption({ label: 'Travel - Taxi' });
      console.log('  Travel - Taxi を選択しました（native select）');
    } else {
      const selectDropdownEl = page.locator("select, div.item.active").filter({ hasText: 'Select Expenses to Add' }).first();
      await selectDropdownEl.waitFor({ state: 'visible', timeout: 15000 });
      await selectDropdownEl.click();
      await page.waitForTimeout(2000);
      await saveScreenshot(page, '03a_dropdown_opened');
      for (const loc of [
        page.getByText('Travel - Taxi', { exact: true }),
        page.locator("a:has-text('Travel - Taxi')"),
        page.locator("li:has-text('Travel - Taxi')"),
      ]) {
        try {
          if ((await loc.count()) > 0 && (await loc.first().isVisible())) {
            await loc.first().click();
            console.log('  Travel - Taxi を選択しました');
            break;
          }
        } catch {}
      }
    }

    // フォームの読み込み完了を待つ（Charge Code フィールドが現れるまで）
    console.log('  フォームの読み込みを待機中...');
    await page.waitForSelector(
      "div.myte-charge-code-field, [aria-label='Select a Charge Code'], input#amount_input",
      { timeout: 30000 }
    );
    await page.waitForTimeout(1000);
    await saveScreenshot(page, '03b_form_appeared');

    // [4] Charge Code
    console.log(`[4] Charge Code「${f.charge_code}」を選択...`);
    if (!await selectChargeCode(page, f.charge_code)) {
      console.error('  警告: Charge Code の自動選択に失敗しました。手動で選択してください。');
    }
    await saveScreenshot(page, '04_charge_code_done');

    // [5] Amount
    console.log(`[5] Amount「${f.amount}」を入力...`);
    for (const sel of ['#amount_input', "input[aria-label='Amount']", "input[type='number']"]) {
      try {
        const el = page.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible())) {
          await el.fill(String(f.amount));
          console.log(`  Amount = ${f.amount} を入力しました`);
          break;
        }
      } catch {}
    }

    // [6] Country/Region（Japan固定）
    console.log('[6] Country/Region → Japan...');
    await selectDropdown(page, 'Country', 'Japan');

    // [7] On（日付）: プレースホルダーが m/d/yyyy のため yyyy/mm/dd → m/d/yyyy に変換
    console.log(`[7] 日付「${f.on_date}」を入力...`);
    const dateParts = f.on_date.split('/');
    const dateForInput = dateParts.length === 3
      ? `${parseInt(dateParts[1])}/${parseInt(dateParts[2])}/${dateParts[0]}`
      : f.on_date;
    for (const sel of [
      "input[formcontrolname*='date' i]",
      "input[placeholder*='yyyy' i]",
      '#on_input',
    ]) {
      try {
        const el = page.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible())) {
          await el.click();
          await el.press('Control+a');
          await el.pressSequentially(dateForInput, { delay: 50 });
          await page.keyboard.press('Tab');
          console.log(`  日付 = ${dateForInput} を入力しました`);
          break;
        }
      } catch {}
    }

    // [8] Reason
    console.log(`[8] Reason「${f.reason}」を選択...`);
    if (!await selectDropdown(page, 'Reason', f.reason)) {
      await saveScreenshot(page, '08_reason_failed');
      console.error('  警告: Reason の自動選択に失敗しました。手動で選択してください。');
    }

    // [9] Purpose
    console.log(`[9] Purpose「${f.purpose}」を選択...`);
    if (!await selectDropdown(page, 'Purpose', f.purpose)) {
      console.error('  警告: Purpose の自動選択に失敗しました。手動で選択してください。');
    }

    // [10] Consumption Type（10%固定）
    console.log(`[10] Consumption Type「${f.consumption_type}」を選択...`);
    await selectDropdown(page, 'Consumption Type', f.consumption_type);

    // [11] VAT Registered Number
    if (f.vat_registered_number) {
      console.log(`[11] VAT Registered Number「${f.vat_registered_number}」を入力...`);
      await fillByLabel(page, 'VAT Registered Number', f.vat_registered_number);
    }

    // [12] From Location
    if (f.from_location) {
      console.log(`[12] From Location「${f.from_location}」を入力...`);
      await fillByLabel(page, 'From Location', f.from_location);
    }

    // [13] To Location
    if (f.to_location) {
      console.log(`[13] To Location「${f.to_location}」を入力...`);
      await fillByLabel(page, 'To Location', f.to_location);
    }

    // [14] Comments
    if (f.comments) {
      console.log('[14] Comments を入力...');
      try {
        const textarea = page.locator('textarea').first();
        if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
          await textarea.fill(f.comments.slice(0, 200));
          console.log('  Comments を入力しました');
        }
      } catch {}
    }

    // [15] 領収書画像のアップロード
    if (IMAGE_PATH && fs.existsSync(IMAGE_PATH)) {
      console.log(`[15] 領収書画像をアップロード: ${path.basename(IMAGE_PATH)}`);
      try {
        const fileInput = page.locator("input[type='file']").first();
        if ((await fileInput.count()) > 0) {
          await fileInput.setInputFiles(IMAGE_PATH);
          await page.waitForTimeout(2000);
          console.log('  領収書画像をアップロードしました');
        } else {
          await page.locator("button:has-text('Upload Receipt'), [aria-label*='Upload' i]").first().click();
          await page.waitForTimeout(500);
          await page.locator("input[type='file']").first().setInputFiles(IMAGE_PATH);
          await page.waitForTimeout(2000);
          console.log('  領収書画像をアップロードしました（ボタン経由）');
        }
      } catch (e) {
        console.error(`  警告: 画像アップロード失敗: ${e.message}`);
      }
    } else if (IMAGE_PATH) {
      console.error(`  警告: 画像ファイルが見つかりません: ${IMAGE_PATH}`);
    }

    await saveScreenshot(page, '05_form_filled');
    console.log('\n✅ 全フィールドの入力が完了しました。');
    console.log(`スクリーンショット: ${SCREENSHOT_DIR}`);
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
