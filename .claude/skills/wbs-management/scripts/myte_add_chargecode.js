/**
 * myTE Charge Code 登録スクリプト
 * 指定されたCharge Codeを myTE の CHARGE CODE タブに追加する。
 * SSOセッション切れの場合はセッション保存を自動実行してリトライする。
 *
 * 使い方:
 *   node myte_add_chargecode.js <charge_code>
 *   例: node myte_add_chargecode.js CJDK4001
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const PROJECT_ROOT = 'C:\\work\\2026\\20260301_claude_skills_myTE';
const USER_DATA_DIR = path.join(PROJECT_ROOT, '.myte', 'browser-data');
const SESSION_BAT = path.join(PROJECT_ROOT, 'セッション保存.bat');

const chargeCode = process.argv[2];
if (!chargeCode) {
  console.error('エラー: Charge Codeを引数で指定してください');
  console.error('使い方: node myte_add_chargecode.js <charge_code>');
  process.exit(1);
}

async function promptEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question(message, () => { rl.close(); resolve(); }));
}

async function runSessionSetup() {
  console.log('\n⚠️  SSOセッションが切れています。セッション保存を実行します...');
  console.log('別ウィンドウでブラウザが起動します。\n');

  execSync(`start cmd /c "${SESSION_BAT}"`, { stdio: 'inherit', shell: true });

  await promptEnter('SSO認証が完了したらEnterキーを押してください > ');
  console.log('セッション更新完了。Charge Code 登録をリトライします...\n');
}

async function addChargeCode() {
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

  // about:blank タブを閉じる（persistent context は起動のたびに追加するため）
  const allPages = browser.pages();
  for (const p of allPages) {
    if (p.url() === 'about:blank' && allPages.length > 1) {
      await p.close();
    }
  }
  const page = browser.pages()[0] || await browser.newPage();

  try {
    // 1. myTE にアクセス（SSOリダイレクト中のタイムアウトは無視）
    console.log('myTE を開きます...');
    try {
      await page.goto('https://myte.accenture.com/#/time', {
        waitUntil: 'load',
        timeout: 120000,
      });
    } catch (e) {
      console.log('（ページ遷移待機中...）');
    }

    // 2. myTE アプリのロード完了を待つ（CHARGE CODE タブの出現で判定）
    //    SSOリダイレクト → FIDO認証 → myTEに戻る → アプリロード を全て待機
    console.log('CHARGE CODE タブを開きます...');
    const chargeCodeTab = page.locator('text=CHARGE CODE').first();
    try {
      await chargeCodeTab.waitFor({ state: 'visible', timeout: 120000 });
    } catch (e) {
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('microsoftonline')) {
        await browser.close();
        return 'sso_expired';
      }
      throw e;
    }
    await chargeCodeTab.click();
    await page.waitForTimeout(1000);

    // 3. Enter Charge Code 入力欄にコードを入力
    console.log(`"${chargeCode}" を入力します...`);
    const input = page.locator('input.add-charge-code').first();
    await input.click({ timeout: 10000 });
    await input.pressSequentially(chargeCode, { delay: 80 });
    await page.waitForTimeout(500);

    // 4. Add ボタンが有効になるまで待ってからクリック
    console.log('Add ボタンを押します...');
    await page.waitForFunction(
      () => !document.querySelector('#Chargecodes_Grid_Controls_Add_Button')?.disabled,
      { timeout: 10000 }
    );
    const addButton = page.locator('#Chargecodes_Grid_Controls_Add_Button');
    await addButton.click({ timeout: 10000 });
    await page.waitForTimeout(2000);

    console.log(`\n✅ Charge Code "${chargeCode}" を myTE に登録しました。`);
    return 'success';
  } catch (err) {
    console.error(`\nエラーが発生しました: ${err.message}`);
    return 'error';
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log(`Charge Code "${chargeCode}" を myTE に登録します...`);

  let result = await addChargeCode();

  // SSO切れの場合: セッション保存 → リトライ（1回のみ）
  if (result === 'sso_expired') {
    await runSessionSetup();
    result = await addChargeCode();
  }

  if (result === 'success') {
    process.exit(0);
  } else if (result === 'sso_expired') {
    console.error('エラー: セッション更新後もSSO認証に失敗しました。');
    process.exit(2);
  } else {
    process.exit(3);
  }
})();
