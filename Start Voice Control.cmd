@echo off
title Voice Control
cd /d "%~dp0"
set RUST_LOG=warn
simulang run voice.ts
pause
