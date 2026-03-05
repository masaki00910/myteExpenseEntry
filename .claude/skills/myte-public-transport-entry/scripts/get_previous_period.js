/**
 * 前回ピリオドの請求済み終了日を取得するスクリプト
 * myTE にアクセスし、前回ピリオドの EXPENSES タブから
 * Travel - Public, Limo, & Other の To 日付を読み取って stdout に出力する。
 *
 * 使い方:
 *   node get_previous_period.js
 *
 * 出力（stdout、JSON形式）:
 *   {"lastDate":"2/15/2026","success":true}
 *   または
 *   {"lastDate":null,"success":true,"message":"エントリなし"}
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = 'C:\\work\\2026\\20260301_claude_skills_myTE';
const USER_DATA_DIR = path.join(PROJECT_ROOT, '.myte', 'browser-data');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'data', 'screenshots');

async function saveScreenshot(page, name) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath });
}

(async () => {
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
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
    // 1. myTE にアクセス
    console.error('[1] myTEにアクセス中...');
    await page.goto('https://myte.accenture.com/#/time', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // SSOセッション確認
    try {
      await page.waitForSelector('text=EXPENSES', { timeout: 15000 });
    } catch {
      console.error('  SSOログインが必要です。ブラウザでログインしてください...');
      await page.waitForURL('**/myte.accenture.com/**', { timeout: 120000 });
      await page.waitForSelector('text=EXPENSES', { timeout: 30000 });
    }

    // 2. EXPENSESタブ
    console.error('[2] EXPENSESタブをクリック...');
    await page.locator('text=EXPENSES').first().click();
    await page.waitForTimeout(2000);

    // 3. 前回ピリオドに移動
    console.error('[3] 前回ピリオドに移動...');
    const prevButton = page.locator('button[aria-label*="Previous"], button:has(mat-icon[fonticon="chevron_left"]), button:has(mat-icon:has-text("chevron_left"))').first();
    if ((await prevButton.count()) === 0) {
      console.log(JSON.stringify({ lastDate: null, success: true, message: '前回ピリオドへの移動ボタンが見つかりません' }));
      await browser.close();
      process.exit(0);
    }

    await prevButton.click();
    await page.waitForTimeout(3000);
    await saveScreenshot(page, 'prev_period_expenses');

    // 4. Travel - Public のエントリから To 日付を取得
    // ag-grid の構造:
    //   各行: div[role="row"].ag-row
    //   Expense Type列: div[col-id="expenseType"] → span に "Travel - Public, Limo, & Other"
    //   To日付列: div[col-id="toDate"] → span に "15 Feb" 形式
    console.error('[4] Travel - Public のエントリを検索中...');
    const lastDate = await page.evaluate(() => {
      const rows = document.querySelectorAll('div[role="row"].ag-row');
      let latestTo = null;

      for (const row of rows) {
        // Expense Type列のテキストを取得
        const expenseTypeCell = row.querySelector('div[col-id="expenseType"]');
        if (!expenseTypeCell) continue;
        const expenseType = expenseTypeCell.textContent.trim();

        if (!expenseType.includes('Travel - Public') && !expenseType.includes('Public, Limo')) {
          continue;
        }

        // To日付列のテキストを取得（"15 Feb" 形式）
        const toDateCell = row.querySelector('div[col-id="toDate"]');
        if (!toDateCell) continue;
        const toDateText = toDateCell.textContent.trim();

        if (toDateText) {
          latestTo = toDateText;
        }
      }

      return latestTo;
    });

    // 5. 今のピリオドに戻る
    console.error('[5] 今のピリオドに戻る...');
    const nextButton = page.locator('button[aria-label*="Next"], button:has(mat-icon[fonticon="chevron_right"]), button:has(mat-icon:has-text("chevron_right"))').first();
    if ((await nextButton.count()) > 0) {
      await nextButton.click();
      await page.waitForTimeout(2000);
    }

    // "15 Feb" 形式を "yyyy/mm/dd" に変換する
    // ピリオドのURLや表示から年を推定（現在のピリオドの前なので同年or前年）
    const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                       Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    let parsedDate = null;
    if (lastDate) {
      const match = lastDate.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = monthMap[match[2]];
        const year = new Date().getFullYear(); // 前回ピリオドなので基本的に同年
        parsedDate = `${year}/${month}/${day}`;
      }
    }

    // 結果を stdout に JSON で出力（console.log = stdout）
    if (parsedDate) {
      console.error(`  前回請求済み終了日: ${lastDate} → ${parsedDate}`);
      console.log(JSON.stringify({ lastDate: parsedDate, rawDate: lastDate, success: true }));
    } else if (lastDate) {
      console.error(`  日付取得したがパース失敗: ${lastDate}`);
      console.log(JSON.stringify({ lastDate: null, rawDate: lastDate, success: true, message: '日付パース失敗' }));
    } else {
      console.error('  前回ピリオドに Travel - Public のエントリが見つかりませんでした');
      console.log(JSON.stringify({ lastDate: null, success: true, message: 'エントリなし' }));
    }

  } catch (err) {
    console.error(`エラー: ${err.message}`);
    console.log(JSON.stringify({ lastDate: null, success: false, error: err.message }));
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
