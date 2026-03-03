@echo off
cd /d "C:\work\2026\20260301_claude_skills_myTE"
echo myTE セッション保存ツール
echo ブラウザが起動したらSSOログインしてください
echo.
node scripts/myte_session_setup.js
pause
