@echo off
cd /d "%~dp0"

set REPO_URL=https://github.com/qicongwei/social-survey-quiz.git

echo ============================================
echo  Push  Social Survey Quiz  to GitHub
echo  Target: %REPO_URL%
echo ============================================
echo.

git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo Pushing... sign in with your GitHub account if prompted.
echo.

git push -u origin main

if errorlevel 1 goto fail
echo.
echo [OK] Pushed: https://github.com/qicongwei/social-survey-quiz
goto done

:fail
echo.
echo [FAILED] Check these:
echo   1. Repository social-survey-quiz does not exist on GitHub yet
echo   2. You ticked "Add a README" when creating it (remote must be empty)
echo   3. You cancelled the sign-in window
echo.
echo Fix: create an empty repo at https://github.com/new (no README), then run again.

:done
echo.
pause
