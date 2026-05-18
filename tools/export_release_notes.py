from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
APP_METADATA_PATH = ROOT_DIR / "app_metadata.py"
CHANGELOG_PATH = ROOT_DIR / "CHANGELOG.md"


def get_project_version() -> str:
    content = APP_METADATA_PATH.read_text(encoding="utf-8")
    match = re.search(r'version="(?P<version>\d+\.\d+\.\d+)"', content)
    if not match:
        raise RuntimeError("Could not resolve version from app_metadata.py")
    return match.group("version")


def get_release_section(markdown: str, version: str) -> tuple[str, str]:
    header_pattern = re.compile(
        rf"^##\s+{re.escape(version)}\s+-\s+(?P<date>\d{{4}}-\d{{2}}-\d{{2}})\s*$",
        re.MULTILINE,
    )
    match = header_pattern.search(markdown)
    if not match:
        raise RuntimeError(f"CHANGELOG.md does not contain a section for version {version}")

    body_start = match.end()
    remaining = markdown[body_start:]
    next_header = re.search(r"^##\s+", remaining, re.MULTILINE)
    body = remaining[: next_header.start()] if next_header else remaining
    return match.group("date"), body.strip()


def build_release_notes(version: str) -> str:
    changelog = CHANGELOG_PATH.read_text(encoding="utf-8")
    release_date, release_body = get_release_section(changelog, version)
    return (
        f"# EveryDayPerfect v{version}\n\n"
        f"\u53d1\u5e03\u65e5\u671f\uff1a{release_date}\n\n"
        f"## \u66f4\u65b0\u5185\u5bb9\n{release_body}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="")
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    version = args.version or get_project_version()
    content = build_release_notes(version)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(content, encoding="utf-8")
        print(f"[ok] Release notes exported: {output_path}")
    else:
        sys.stdout.write(content)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
