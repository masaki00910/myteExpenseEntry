/**
 * myTE セッション初期設定スクリプト
 * 初回実行時にSSOログインを行い、セッションを .myte/browser-data/ に保存します。
 * 2回目以降は保存済みセッションが自動的に使用されます。
 */
const { chromium } = require('playwright');
const path = require('path');
const readline = require('readline');

(async () => {
  const userDataDir = path.join(
    'C:\\work\\2026\\20260301_claude_skills_myTE',
    '.myte', 'browser-data'
  );

  console.log('ブラウザを起動します...');
  console.log('保存先:', userDataDir);

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
    // システムのEdge/Chromeプロファイルを使う場合はchannelを指定
    // channel: 'msedge',
  });

  const page = browser.pages()[0] || await browser.newPage();

  console.log('\nmyTEを開きます...');
  await page.goto('https://myte.accenture.com', { waitUntil: 'load', timeout: 30000 });

  console.log('\n========================================');
  console.log('ブラウザでSSO認証を完了してください。');
  console.log('myTEのトップページが表示されたら');
  console.log('このターミナルでEnterキーを押してください。');
  console.log('========================================\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('Enterで保存して終了 > ', () => { rl.close(); resolve(); }));

  await browser.close();
  console.log('\n✅ セッションを保存しました。');
  console.log('次回から自動ログインが使用されます。');
})();
