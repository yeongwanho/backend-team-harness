@echo off
if not "%~1"=="" exit /b 64
"%BTH_NODE%" "%~dp0verify-public-maven.mjs"
exit /b %errorlevel%
