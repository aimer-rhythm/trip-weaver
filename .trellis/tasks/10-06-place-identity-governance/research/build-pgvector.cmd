@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1
set "PGROOT=C:\Program Files\PostgreSQL\16"
cd /d "D:\Project\tripweaver\data\pgvector-build\pgvector-0.8.2"
nmake /F Makefile.win
