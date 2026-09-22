@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   AI HTML 汇报修改台 · 一键同步打包
echo   源文件：html-editor.html
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装：https://nodejs.org
  pause
  exit /b 1
)
node "html-editor-extension\tools\sync-all.js"
echo.
echo 完成后请回到 chrome://extensions 点扩展卡片上的「重新加载」。
pause
