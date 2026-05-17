# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

project_root = Path(SPECPATH).resolve().parents[1]
frontend_dist = project_root / "frontend" / "dist"
windows_packaging_dir = project_root / "packaging" / "windows"

sys.path.insert(0, str(project_root))

from app_metadata import APP_METADATA

datas = collect_data_files("webview")
if frontend_dist.exists():
    datas.append((str(frontend_dist), "frontend_dist"))

hiddenimports = collect_submodules("webview") + collect_submodules("app") + [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
]

a = Analysis(
    [str(project_root / "desktop_launcher.py")],
    pathex=[str(project_root), str(project_root / "backend")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_METADATA.exe_name,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=str(windows_packaging_dir / "EveryDayPerfect.ico"),
    version=str(windows_packaging_dir / "version_info.txt"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name=APP_METADATA.name,
)
