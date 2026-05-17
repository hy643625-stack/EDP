from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from app_metadata import APP_METADATA

WINDOWS_DIR = Path(__file__).resolve().parent
ICON_PATH = WINDOWS_DIR / "EveryDayPerfect.ico"
VERSION_INFO_PATH = WINDOWS_DIR / "version_info.txt"
ISS_METADATA_PATH = WINDOWS_DIR / "app_metadata.iss"


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 1.0 if value >= edge1 else 0.0
    t = _clamp((value - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _lerp_color(start: tuple[int, int, int], end: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(_lerp(float(sa), float(ea), t))) for sa, ea in zip(start, end))


def _rounded_rect_signed_distance(
    x: float,
    y: float,
    center_x: float,
    center_y: float,
    half_w: float,
    half_h: float,
    radius: float,
) -> float:
    dx = abs(x - center_x) - (half_w - radius)
    dy = abs(y - center_y) - (half_h - radius)
    outside = (max(dx, 0.0) ** 2 + max(dy, 0.0) ** 2) ** 0.5
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def _segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    denominator = abx * abx + aby * aby
    if denominator == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = _clamp((apx * abx + apy * aby) / denominator)
    closest_x = ax + abx * t
    closest_y = ay + aby * t
    return ((px - closest_x) ** 2 + (py - closest_y) ** 2) ** 0.5


def _encode_png(width: int, height: int, rgba: bytes) -> bytes:
    def png_chunk(kind: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(kind)
        crc = zlib.crc32(payload, crc)
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc & 0xFFFFFFFF)

    rows = bytearray()
    stride = width * 4
    for row_index in range(height):
        rows.append(0)
        start = row_index * stride
        rows.extend(rgba[start : start + stride])

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    image_data = zlib.compress(bytes(rows), level=9)
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", image_data) + png_chunk(b"IEND", b"")


def _build_icon_png(size: int = 256) -> bytes:
    pixels = bytearray(size * size * 4)
    center = (size - 1) / 2.0
    background_start = (108, 158, 124)
    background_end = (24, 43, 68)
    highlight_color = (255, 255, 255)
    accent_color = (250, 196, 106)

    rect_half_w = size * 0.39
    rect_half_h = size * 0.39
    rect_radius = size * 0.16

    for y in range(size):
        for x in range(size):
            px = x + 0.5
            py = y + 0.5
            normalized_x = px / size
            normalized_y = py / size

            rect_distance = _rounded_rect_signed_distance(px, py, center + 0.5, center + 0.5, rect_half_w, rect_half_h, rect_radius)
            base_alpha = _smoothstep(1.5, -1.5, rect_distance)

            gradient_mix = _clamp((normalized_x * 0.42) + (normalized_y * 0.58))
            background = _lerp_color(background_start, background_end, gradient_mix)

            radial = ((px - size * 0.32) ** 2 + (py - size * 0.24) ** 2) ** 0.5 / (size * 0.92)
            glow_strength = _clamp(1.0 - radial)
            background = tuple(
                int(round(channel + (255 - channel) * glow_strength * 0.13))
                for channel in background
            )

            overlay_distance = _rounded_rect_signed_distance(
                px,
                py,
                center + 0.5,
                center + 0.5,
                rect_half_w - 10,
                rect_half_h - 10,
                rect_radius - 8,
            )
            overlay_alpha = _smoothstep(1.5, -1.5, overlay_distance) * 0.12
            r = int(round(_lerp(background[0], highlight_color[0], overlay_alpha)))
            g = int(round(_lerp(background[1], highlight_color[1], overlay_alpha)))
            b = int(round(_lerp(background[2], highlight_color[2], overlay_alpha)))

            shadow_strength = 0.0
            for ax, ay, bx, by in (
                (78.0, 138.0, 114.0, 176.0),
                (112.0, 174.0, 186.0, 92.0),
            ):
                shadow_distance = _segment_distance(px - 2.5, py - 4.0, ax, ay, bx, by)
                shadow_strength = max(shadow_strength, _smoothstep(20.0, 8.0, shadow_distance))
            if shadow_strength > 0:
                shadow_mix = shadow_strength * 0.24
                r = int(round(_lerp(r, 0.0, shadow_mix)))
                g = int(round(_lerp(g, 0.0, shadow_mix)))
                b = int(round(_lerp(b, 0.0, shadow_mix)))

            check_strength = 0.0
            for ax, ay, bx, by in (
                (76.0, 136.0, 114.0, 174.0),
                (112.0, 172.0, 186.0, 90.0),
            ):
                check_distance = _segment_distance(px, py, ax, ay, bx, by)
                check_strength = max(check_strength, _smoothstep(18.0, 7.0, check_distance))
            if check_strength > 0:
                r = int(round(_lerp(r, 255.0, check_strength)))
                g = int(round(_lerp(g, 255.0, check_strength)))
                b = int(round(_lerp(b, 255.0, check_strength)))

            accent_distance = ((px - size * 0.73) ** 2 + (py - size * 0.29) ** 2) ** 0.5
            accent_strength = _smoothstep(size * 0.12, size * 0.055, accent_distance)
            if accent_strength > 0:
                r = int(round(_lerp(r, accent_color[0], accent_strength)))
                g = int(round(_lerp(g, accent_color[1], accent_strength)))
                b = int(round(_lerp(b, accent_color[2], accent_strength)))

            alpha = int(round(255 * base_alpha))
            index = (y * size + x) * 4
            pixels[index : index + 4] = bytes((r, g, b, alpha))

    return _encode_png(size, size, bytes(pixels))


def _write_ico(path: Path, png_bytes: bytes, size: int = 256) -> None:
    icon_dir = struct.pack("<HHH", 0, 1, 1)
    image_size = len(png_bytes)
    directory_entry = struct.pack(
        "<BBBBHHII",
        0 if size >= 256 else size,
        0 if size >= 256 else size,
        0,
        0,
        1,
        32,
        image_size,
        6 + 16,
    )
    path.write_bytes(icon_dir + directory_entry + png_bytes)


def _write_version_info(path: Path) -> None:
    version_tuple = APP_METADATA.version_tuple
    version_comma = ", ".join(str(part) for part in version_tuple)
    version_dot = ".".join(str(part) for part in version_tuple)
    content = f"""VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=({version_comma}),
    prodvers=({version_comma}),
    mask=0x3F,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
    ),
  kids=[
    StringFileInfo(
      [
        StringTable(
          '040904B0',
          [
            StringStruct('CompanyName', '{APP_METADATA.publisher}'),
            StringStruct('FileDescription', '{APP_METADATA.description}'),
            StringStruct('FileVersion', '{version_dot}'),
            StringStruct('InternalName', '{APP_METADATA.exe_name}'),
            StringStruct('OriginalFilename', '{APP_METADATA.exe_filename}'),
            StringStruct('ProductName', '{APP_METADATA.name}'),
            StringStruct('ProductVersion', '{APP_METADATA.version}'),
            StringStruct('LegalCopyright', '{APP_METADATA.copyright}')
          ]
        )
      ]
    ),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""
    path.write_text(content, encoding="utf-8")


def _escape_iss(value: str) -> str:
    return value.replace('"', '""')


def _write_iss_metadata(path: Path) -> None:
    lines = [
        f'#define MyAppName "{_escape_iss(APP_METADATA.name)}"',
        f'#define MyAppExeName "{_escape_iss(APP_METADATA.exe_filename)}"',
        f'#define MyAppVersion "{_escape_iss(APP_METADATA.version)}"',
        f'#define MyAppPublisher "{_escape_iss(APP_METADATA.publisher)}"',
        f'#define MyAppDescription "{_escape_iss(APP_METADATA.description)}"',
        f'#define MyInstallDirName "{_escape_iss(APP_METADATA.install_dir_name)}"',
        f'#define MyAppId "{{{{{_escape_iss(APP_METADATA.app_id_guid)}}}}}"',
        f'#define MyAppURL "{_escape_iss(APP_METADATA.support_url)}"',
        f'#define MyAppCopyright "{_escape_iss(APP_METADATA.copyright)}"',
        f'#define MyOutputBaseFilename "{_escape_iss(APP_METADATA.installer_base_filename)}"',
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    png_bytes = _build_icon_png()
    _write_ico(ICON_PATH, png_bytes)
    _write_version_info(VERSION_INFO_PATH)
    _write_iss_metadata(ISS_METADATA_PATH)
    print(f"[ok] Generated Windows assets in {WINDOWS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
