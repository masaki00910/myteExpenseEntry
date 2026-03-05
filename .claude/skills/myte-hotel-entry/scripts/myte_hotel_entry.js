const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = 'C:\\work\\2026\\20260301_claude_skills_myTE';
const PENDING_DIR = path.join(PROJECT_ROOT, 'data', 'pending');
const DONE_DIR = path.join(PROJECT_ROOT, 'data', 'done');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'data', 'screenshots');

// エントリIDをCLI引数から取得（例: node myte_hotel_entry.js 20260211-A302005）
const entryId = process.argv[2];
if (!entryId) {
  console.error('使い方: node myte_hotel_entry.js <entryId>');
  console.error('例: node myte_hotel_entry.js 20260211-A302005');
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
// Charge Code 選択（ag-grid コンボボックス）- taxiスクリプトと同一
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
  await saveScreenshot(page, '04a_charge_code_expanded');

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
  await saveScreenshot(page, '04b_charge_code_typed');

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
// ドロップダウン選択 - taxiスクリプトと同一
// ---------------------------------------------------------------------------
async function selectDropdown(page, labelText, optionText) {
  const harrVersion = optionText.replace('<->', '\u2194');
  const normalizedVersion = optionText.replace('\u2194', '<->');
  const candidates = [...new Set([harrVersion, optionText, normalizedVersion])];

  await page.waitForTimeout(500);

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

  try {
    const combobox = page.locator(`div[role='combobox'][aria-label*='${labelText}' i]`).first();
    if ((await combobox.count()) === 0) return false;

    let trigger = combobox.locator('div.item.active').first();
    if ((await trigger.count()) === 0) trigger = combobox;

    await trigger.click();
    await page.waitForTimeout(1500);

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
// テキスト入力（ラベルベース）- taxiスクリプトと同一
// ---------------------------------------------------------------------------
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
      const el = page.locator(`#${forId}`);
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
// 日付入力（yyyy/mm/dd → m/d/yyyy 変換）- taxiスクリプトと同一ロジック
// ---------------------------------------------------------------------------
async function fillDate(page, selectorCandidates, dateStr, label, convertToMDY = true) {
  const parts = dateStr.split('/');
  const dateForInput = (convertToMDY && parts.length === 3)
    ? `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[0]}`
    : dateStr;
  for (const sel of selectorCandidates) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        // クリックしてフォーカス
        await el.click();
        await page.waitForTimeout(300);
        // 既存値をクリア
        await el.press('Control+a');
        await el.press('Delete');
        await page.waitForTimeout(200);
        // 1文字ずつゆっくり入力
        await el.pressSequentially(dateForInput, { delay: 80 });
        await page.waitForTimeout(500);
        // Angularのchange/blurイベントを発火
        await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }
        }, sel);
        await page.waitForTimeout(300);
        // Tabで確定
        await page.keyboard.press('Tab');
        await page.waitForTimeout(500);
        // 入力値を確認
        const val = await el.inputValue().catch(() => '');
        console.log(`  ${label} = ${dateForInput} を入力しました（確認値: ${val}）`);
        return true;
      }
    } catch {}
  }
  console.error(`  警告: ${label} フィールドが見つかりません`);
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
    await page.waitForSelector('div.item.active', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await saveScreenshot(page, '02_expenses_tab');

    // [3] Accommodation - Hotel を選択
    console.log('[3] Accommodation - Hotelを選択...');
    const nativeSelect = page.locator('select').first();
    if ((await nativeSelect.count()) > 0 && (await nativeSelect.isVisible())) {
      await nativeSelect.selectOption({ label: 'Accommodation - Hotel' });
      console.log('  Accommodation - Hotel を選択しました（native select）');
    } else {
      const selectDropdownEl = page.locator("select, div.item.active").filter({ hasText: 'Select Expenses to Add' }).first();
      await selectDropdownEl.waitFor({ state: 'visible', timeout: 15000 });
      await selectDropdownEl.click();
      await page.waitForTimeout(2000);
      await saveScreenshot(page, '03a_dropdown_opened');
      for (const loc of [
        page.getByText('Accommodation - Hotel', { exact: true }),
        page.locator("a:has-text('Accommodation - Hotel')"),
        page.locator("li:has-text('Accommodation - Hotel')"),
      ]) {
        try {
          if ((await loc.count()) > 0 && (await loc.first().isVisible())) {
            await loc.first().click();
            console.log('  Accommodation - Hotel を選択しました');
            break;
          }
        } catch {}
      }
    }

    // フォームの読み込み完了を待つ
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

    // [7] Check-in 日付（プレースホルダーがm/d/yyyyなのでtaxiと同じ変換が必要）
    console.log(`[7] Check-in「${f.check_in_date}」を入力...`);
    await fillDate(page, ['#from_input'], f.check_in_date, 'Check-in', true);

    // [8] Check-out 日付
    console.log(`[8] Check-out「${f.check_out_date}」を入力...`);
    await fillDate(page, ['#to_input'], f.check_out_date, 'Check-out', true);

    // [9] Hotel Chain → "Other" を選択してからホテル名を入力
    console.log(`[9] Hotel Chain → "Other" を選択...`);
    if (!await selectDropdown(page, 'Hotel Chain', 'Other')) {
      console.error('  警告: Hotel Chain の自動選択に失敗しました');
    }
    await page.waitForTimeout(1000);
    // Other テキスト入力が有効になるまでポーリングで待機
    const otherInput = page.locator('#other_input');
    try {
      await otherInput.waitFor({ state: 'visible', timeout: 5000 });
      // disabled 属性が消えるまで最大5秒待機
      for (let i = 0; i < 10; i++) {
        const isDisabled = await otherInput.getAttribute('disabled');
        if (isDisabled === null) break;
        await page.waitForTimeout(500);
      }
      const isStillDisabled = await otherInput.getAttribute('disabled');
      if (isStillDisabled === null) {
        await otherInput.clear();
        await otherInput.fill(f.hotel_name);
        console.log(`  Hotel Name (Other) = '${f.hotel_name}' を入力しました`);
      } else {
        // disabled が解除されない場合、JavaScriptで直接解除して入力
        console.log('  Other input が disabled のため、直接有効化して入力します...');
        await page.evaluate(() => {
          const el = document.querySelector('#other_input');
          if (el) { el.removeAttribute('disabled'); el.readOnly = false; }
        });
        await page.waitForTimeout(300);
        await otherInput.clear();
        await otherInput.fill(f.hotel_name);
        // Angular の change イベントを発火
        await page.evaluate(() => {
          const el = document.querySelector('#other_input');
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        console.log(`  Hotel Name (Other) = '${f.hotel_name}' を入力しました（強制有効化）`);
      }
    } catch (e) {
      console.error(`  警告: Other input が見つかりません: ${e.message}`);
    }

    // [10] Hotel Location（= Hotel City）
    console.log(`[10] Hotel Location「${f.hotel_city}」を入力...`);
    const hotelLocEl = page.locator('#hotel\\ location_input').first();
    try {
      if ((await hotelLocEl.count()) > 0 && (await hotelLocEl.isVisible())) {
        await hotelLocEl.clear();
        await hotelLocEl.fill(f.hotel_city);
        console.log(`  Hotel Location = '${f.hotel_city}' を入力しました`);
      } else {
        await fillByLabel(page, 'Hotel Location', f.hotel_city);
      }
    } catch (e) {
      await fillByLabel(page, 'Hotel Location', f.hotel_city);
    }

    // [11] Consumption Type（10%固定）
    console.log(`[11] Consumption Type「${f.consumption_type}」を選択...`);
    await selectDropdown(page, 'Consumption Type', f.consumption_type);

    // [12] VAT Registered Number（IDにスペースが含まれるためCSS escapeが必要）
    if (f.vat_registered_number) {
      console.log(`[12] VAT Registered Number「${f.vat_registered_number}」を入力...`);
      const vatEl = page.locator('#vat\\ registered\\ number_input').first();
      try {
        if ((await vatEl.count()) > 0 && (await vatEl.isVisible())) {
          await vatEl.clear();
          await vatEl.fill(f.vat_registered_number);
          console.log(`  VAT Registered Number = '${f.vat_registered_number}' を入力しました`);
        } else {
          await fillByLabel(page, 'VAT Registered Number', f.vat_registered_number);
        }
      } catch (e) {
        await fillByLabel(page, 'VAT Registered Number', f.vat_registered_number);
      }
    }

    // [13] Comments（空なのでスキップ）

    // [14] 領収書画像のアップロード
    if (IMAGE_PATH && fs.existsSync(IMAGE_PATH)) {
      console.log(`[14] 領収書画像をアップロード: ${path.basename(IMAGE_PATH)}`);
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
    console.log('\n全フィールドの入力が完了しました。');
    console.log(`スクリーンショット: ${SCREENSHOT_DIR}`);
    console.log('\n問題なければブラウザで「Save」ボタンを押してください。');
    console.log('ブラウザを閉じると終了します。');

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
