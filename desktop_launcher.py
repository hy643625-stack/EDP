from __future__ import annotations

import os
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn
from app_metadata import APP_METADATA

APP_NAME = APP_METADATA.name
DEFAULT_PORT = 18765


def _project_root() -> Path:
    return Path(__file__).resolve().parent


def _backend_root() -> Path:
    return _project_root() / "backend"


def _ensure_python_paths() -> None:
    if getattr(sys, "frozen", False):
        return

    for candidate in (_project_root(), _backend_root()):
        candidate_str = str(candidate)
        if candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)


def _bundled_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return _project_root()


def _resolve_db_path() -> Path:
    configured = os.getenv("TASK_DB_PATH", "").strip()
    if configured:
        db_path = Path(configured)
    else:
        local_app_data = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        db_dir = local_app_data / APP_NAME
        db_dir.mkdir(parents=True, exist_ok=True)
        db_path = db_dir / "task.db"

    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path


def _logs_dir() -> Path:
    local_app_data = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    path = local_app_data / APP_NAME / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _log_file_path() -> Path:
    return _logs_dir() / "desktop-launcher.log"


def _write_log(message: str) -> None:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {message}\n"
    try:
        _log_file_path().open("a", encoding="utf-8").write(line)
    except OSError:
        pass


def _show_error_dialog(title: str, message: str) -> None:
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
    except Exception:
        pass


def _resolve_frontend_dist() -> Path | None:
    configured = os.getenv("FRONTEND_DIST_PATH", "").strip()
    candidates = []
    if configured:
        candidates.append(Path(configured))

    bundled_root = _bundled_root()
    candidates.extend(
        [
            bundled_root / "frontend_dist",
            _project_root() / "frontend" / "dist",
        ]
    )

    for candidate in candidates:
        if (candidate / "index.html").is_file():
            return candidate
    return None


def _find_available_port(preferred: int) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            probe.bind(("127.0.0.1", 0))
            return int(probe.getsockname()[1])


def _wait_for_server(url: str, timeout_seconds: float = 20.0) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            time.sleep(0.25)
    raise RuntimeError(f"Desktop backend did not become ready at {url}") from last_error


class DesktopServerThread(threading.Thread):
    def __init__(self, port: int) -> None:
        super().__init__(daemon=True)
        self.port = port
        self.server: uvicorn.Server | None = None
        self.error: Exception | None = None

    def run(self) -> None:
        try:
            _ensure_python_paths()
            from app.config import Settings
            from app.main import create_app

            db_path = _resolve_db_path()
            frontend_dist_path = _resolve_frontend_dist()
            _write_log(f"Starting embedded backend on 127.0.0.1:{self.port} using db={db_path}")
            settings = Settings(
                db_path=db_path,
                cors_origins=(f"http://127.0.0.1:{self.port}", f"http://localhost:{self.port}"),
                frontend_dist_path=frontend_dist_path,
            )
            app = create_app(settings)
            config = uvicorn.Config(
                app,
                host="127.0.0.1",
                port=self.port,
                log_level="warning",
                access_log=False,
                log_config=None,
            )
            self.server = uvicorn.Server(config)
            self.server.run()
        except Exception as exc:
            self.error = exc
            _write_log("Embedded backend thread crashed:")
            _write_log(traceback.format_exc())

    def stop(self) -> None:
        if self.server is not None:
            self.server.should_exit = True


def main() -> int:
    _ensure_python_paths()
    _write_log("Desktop launcher starting")
    frontend_dist_path = _resolve_frontend_dist()
    if frontend_dist_path is None:
        message = "Frontend dist bundle not found. Build the frontend before launching the desktop app."
        _write_log(message)
        print(message, file=sys.stderr)
        _show_error_dialog(APP_NAME, message)
        return 1

    port = _find_available_port(DEFAULT_PORT)
    base_url = f"http://127.0.0.1:{port}"

    server_thread = DesktopServerThread(port)
    server_thread.start()

    try:
        _wait_for_server(f"{base_url}/health")
    except Exception as exc:
        server_thread.stop()
        server_thread.join(timeout=5)
        thread_error = server_thread.error
        if thread_error is not None:
            message = f"Failed to start local backend: {thread_error}"
        else:
            message = f"Failed to start local backend: {exc}"
        _write_log(message)
        if thread_error is not None:
            _write_log(traceback.format_exception_only(type(thread_error), thread_error)[-1].strip())
        print(message, file=sys.stderr)
        _show_error_dialog(APP_NAME, f"{message}\n\nLog: {_log_file_path()}")
        return 1

    try:
        import webview
    except ImportError:
        server_thread.stop()
        server_thread.join(timeout=5)
        message = "pywebview is not installed. Install desktop dependencies before launching the desktop app."
        _write_log(message)
        print(message, file=sys.stderr)
        _show_error_dialog(APP_NAME, message)
        return 1

    try:
        _write_log(f"Opening desktop window at {base_url}")
        webview.create_window(APP_NAME, base_url, width=1360, height=920, min_size=(1100, 720))
        webview.start(debug=not getattr(sys, "frozen", False))
        _write_log("Desktop window closed")
    except Exception as exc:
        _write_log("Desktop window failed:")
        _write_log(traceback.format_exc())
        _show_error_dialog(APP_NAME, f"Desktop window failed to open.\n\n{exc}\n\nLog: {_log_file_path()}")
        raise
    finally:
        server_thread.stop()
        server_thread.join(timeout=5)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
