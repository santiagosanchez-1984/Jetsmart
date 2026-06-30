@echo off
title Smiles Proxy
cd /d "%~dp0"
echo.
echo === Smiles Proxy ===
echo Iniciando... dejá esta ventana abierta mientras usás el tab Smiles.
echo Cerrala cuando termines.
echo.
node smiles-proxy.js
pause
