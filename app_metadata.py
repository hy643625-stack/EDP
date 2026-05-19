from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AppMetadata:
    name: str
    exe_name: str
    version: str
    publisher: str
    description: str
    install_dir_name: str
    app_id_guid: str
    support_url: str
    copyright: str

    @property
    def exe_filename(self) -> str:
        return f"{self.exe_name}.exe"

    @property
    def installer_base_filename(self) -> str:
        return f"{self.name}-Setup-{self.version}"

    @property
    def version_tuple(self) -> tuple[int, int, int, int]:
        parts = [int(part) for part in self.version.split(".") if part]
        while len(parts) < 4:
            parts.append(0)
        return tuple(parts[:4])


APP_METADATA = AppMetadata(
    name="EveryDayPerfect",
    exe_name="EveryDayPerfect",
    version="1.0.3",
    publisher="EveryDayPerfect",
    description="Focused daily execution command center.",
    install_dir_name="EveryDayPerfect",
    app_id_guid="8F46BC15-7AB0-4B39-BD80-39E5B02A7DA9",
    support_url="",
    copyright="Copyright (c) 2026 EveryDayPerfect",
)


