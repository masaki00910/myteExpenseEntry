const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const userDataDir = path.join('C:\work\2026\20260301_claude_skills_myTE', '.myte', 'browser-data');
  
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1920, height: 1080 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo'
  });
  
  const page = browser.pages()[0] || await browser.newPage();
  
  // === Phase 1: ページアクセス ===
  console.log('[Phase 1] Navigating to myTE...');
  await page.goto('https://myte.accenture.com/#/time', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // SSOセッション切れチェック
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl.includes('sso')) {
    console.log('ERROR: SSO session expired. URL: ' + currentUrl);
    await browser.close();
    process.exit(1);
  }
  
  console.log('[Phase 1] Current URL: ' + page.url());
  
  // EXPENSES タブをクリック
  console.log('[Phase 1] Clicking EXPENSES tab...');
  const expensesTab = page.locator('text=EXPENSES').first();
  await expensesTab.waitFor({ timeout: 15000 });
  await expensesTab.click();
  await page.waitForTimeout(2000);
  
  // Select Expenses ドロップダウンを開く
  console.log('[Phase 1] Opening expense dropdown...');
  const dropdown = page.locator('#comboboxselect-expense-dropdown');
  await dropdown.waitFor({ timeout: 10000 });
  await dropdown.click();
  await page.waitForTimeout(1000);
  
  // Accommodation - Hotel を選択
  console.log('[Phase 1] Selecting Accommodation - Hotel...');
  const hotelOption = page.locator('li[aria-label="Accommodation - Hotel add expense"]');
  await hotelOption.waitFor({ timeout: 10000 });
  await hotelOption.click();
  await page.waitForTimeout(2000);
  
  // フォーム表示を待つ
  console.log('[Phase 1] Waiting for form...');
  await page.locator('h1:has-text("Accommodation - Hotel")').waitFor({ timeout: 15000 });
  console.log('[Phase 1] Form loaded successfully.');
  
  // === Phase 2: フォーム入力 ===
  const fields = {
    charge_code: "A302005",
    amount: "70500",
    check_in_date: "2026/02/11",
    check_out_date: "2026/02/14",
    hotel_name: "リーガロイヤルホテル大阪 ヴィニエット コレクション",
    hotel_city: "Osaka",
    vat_registered_number: "T7010003038880"
  };
  
  // 1. Charge Code
  console.log('[Phase 2] Setting Charge Code: ' + fields.charge_code);
  const chargeCodeSelector = page.locator('[aria-label="Select a Charge Code"]');
  await chargeCodeSelector.waitFor({ timeout: 10000 });
  await chargeCodeSelector.click();
  await page.waitForTimeout(1000);
  
  const filterInput = page.locator('#filter-text');
  await filterInput.waitFor({ timeout: 5000 });
  await filterInput.fill(fields.charge_code);
  await page.waitForTimeout(2000);
  
  // Charge Code行を選択
  const chargeCodeRow = page.locator('div[aria-label*="Charge Code: ' + fields.charge_code + '"]').first();
  await chargeCodeRow.waitFor({ timeout: 10000 });
  
  // Disabled チェック
  const ariaLabel = await chargeCodeRow.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.endsWith('Disabled')) {
    console.log('ERROR: Charge Code ' + fields.charge_code + ' is disabled.');
    await browser.close();
    process.exit(2);
  }
  
  await chargeCodeRow.click();
  await page.waitForTimeout(1000);
  console.log('[Phase 2] Charge Code selected.');
  
  // 2. Amount
  console.log('[Phase 2] Setting Amount: ' + fields.amount);
  const amountInput = page.locator('#amount_input');
  await amountInput.waitFor({ timeout: 5000 });
  await amountInput.fill(fields.amount);
  await page.waitForTimeout(300);
  
  // 3. Check-in
  console.log('[Phase 2] Setting Check-in: ' + fields.check_in_date);
  const checkinInput = page.locator('#check_in_input');
  await checkinInput.waitFor({ timeout: 5000 });
  await checkinInput.fill(fields.check_in_date);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  
  // 4. Check-out
  console.log('[Phase 2] Setting Check-out: ' + fields.check_out_date);
  const checkoutInput = page.locator('#check_out_input');
  await checkoutInput.waitFor({ timeout: 5000 });
  await checkoutInput.fill(fields.check_out_date);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  
  // 5. Hotel Name
  console.log('[Phase 2] Setting Hotel Name: ' + fields.hotel_name);
  const hotelNameInput = page.locator('#hotel_name_input');
  await hotelNameInput.waitFor({ timeout: 5000 });
  await hotelNameInput.fill(fields.hotel_name);
  await page.waitForTimeout(300);
  
  // 6. Hotel City
  console.log('[Phase 2] Setting Hotel City: ' + fields.hotel_city);
  const hotelCityInput = page.locator('#hotel_city_input');
  await hotelCityInput.waitFor({ timeout: 5000 });
  await hotelCityInput.fill(fields.hotel_city);
  await page.waitForTimeout(300);
  
  // 7. VAT Registered Number
  console.log('[Phase 2] Setting VAT Number: ' + fields.vat_registered_number);
  const vatInput = page.locator('#vat_registered_number_input');
  await vatInput.waitFor({ timeout: 5000 });
  await vatInput.fill(fields.vat_registered_number);
  await page.waitForTimeout(300);
  
  // Consumption Type はデフォルト10%のためスキップ
  // Country/Region はデフォルトJapanのためスキップ
  // Currency はデフォルトJPYのためスキップ
  // Comments は空のためスキップ
  // Public Official はデフォルトuncheckedのためスキップ
  
  console.log('[Phase 2] All fields filled successfully.');
  console.log('DONE: Form entry complete. Waiting for user to review and save.');
  
  // ブラウザを閉じずに待機（ユーザーが確認・Save操作するため）
  // 10分待機後に自動終了
  await page.waitForTimeout(600000);
  await browser.close();
})();
