@echo off
cd /d "%~dp0"
node .\node_modules\typescript\bin\tsc -b > tsc-out.txt 2>&1
echo EXITCODE:%ERRORLEVEL% >> tsc-out.txt
