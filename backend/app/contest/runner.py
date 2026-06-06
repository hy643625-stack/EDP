"""C++ compilation and execution for contest diagnosis.

WARNING: NOT a security sandbox.
- Code runs as a subprocess on the host machine.
- Preflight audit blocks obvious danger (system/popen/fork/etc) but cannot
  prevent all malicious behavior (e.g. file reads via ifstream).
- Resource limits (CPU, memory, file size) are enforced but can be bypassed.
- macOS sandbox-exec is optional and may not be available.

Only execute code you trust as if you were running it locally.
For untrusted code, use a full VM or container."""

from __future__ import annotations

import os
import re
import resource
import subprocess
import tempfile
import shutil
from dataclasses import dataclass
from typing import Any

COMPILE_TIMEOUT_SEC = 15
RUN_TIMEOUT_SEC = 5
MAX_OUTPUT_BYTES = 100_000

# ── Source audit ─────────────────────────────────────

# Only block unambiguously dangerous calls. Do NOT block #include.
_AUDIT_FORBIDDEN = [
    r"\bsystem\s*\(",
    r"\bpopen\s*\(",
    r"\bfork\s*\(",
    r"\bexec[lvpe]*\s*\(",
    r"\bsocket\s*\(",
    r"\bfopen\s*\(",
    r"\bfreopen\s*\(",
    r"\bremove\s*\(",
    r"\bunlink\s*\(",
    r"\bdlopen\s*\(",
    r"\b__asm\b",
    r"\bsyscall\s*\(",
]


def audit_source(code: str) -> str | None:
    """Return error message if dangerous patterns found, else None."""
    for pattern in _AUDIT_FORBIDDEN:
        if re.search(pattern, code):
            return f"代码包含禁止的系统调用: {pattern}"
    return None


@dataclass
class CompileResult:
    ok: bool
    binary_path: str = ""
    error: str = ""


@dataclass
class RunResult:
    ok: bool
    stdout: str = ""
    stderr: str = ""
    exit_code: int = -1
    timed_out: bool = False
    error: str = ""


@dataclass
class SampleResult:
    index: int
    input_text: str
    expected: str
    actual: str
    passed: bool
    error: str = ""


@dataclass
class HackResult:
    ok: bool
    round_count: int = 0
    first_fail: int = -1
    counterexample_input: str = ""
    wa_output: str = ""
    brute_output: str = ""
    brute_code: str = ""
    generator_code: str = ""
    error: str = ""


# ── Resource limits ──────────────────────────────────

def _limit_resources() -> None:
    """Set OS resource limits before executing user code (called via preexec_fn)."""
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (RUN_TIMEOUT_SEC + 5, RUN_TIMEOUT_SEC + 5))
    except (ValueError, resource.error):
        pass
    try:
        limit = 512 * 1024 * 1024  # 512 MB
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    except (ValueError, resource.error):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_FSIZE, (10 * 1024 * 1024, 10 * 1024 * 1024))
    except (ValueError, resource.error):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, resource.error):
        pass


_HAS_SANDBOX_EXEC = False


def _detect_sandbox_exec() -> bool:
    """Check if sandbox-exec is available and actually works."""
    if shutil.which("sandbox-exec") is None:
        return False
    try:
        # Compile a trivial binary and try running it under sandbox-exec
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "test.cpp")
            out = os.path.join(tmp, "test")
            with open(src, "w") as f:
                f.write("int main() { return 0; }")
            gpp = get_compiler()
            if gpp is None:
                return False
            proc = subprocess.run(
                [gpp, "-std=c++17", src, "-o", out],
                capture_output=True, timeout=10,
            )
            if proc.returncode != 0:
                return False
            proc = subprocess.run(
                ["sandbox-exec", "-p", "(version 1)(allow default)", out],
                capture_output=True, timeout=5,
            )
            return proc.returncode == 0
    except Exception:
        return False


_HAS_SANDBOX_EXEC = _detect_sandbox_exec()


def _sandbox_cmd(binary_path: str) -> list[str]:
    """Wrap binary in macOS sandbox-exec if available."""
    if not _HAS_SANDBOX_EXEC:
        return [binary_path]
    profile = "(version 1)(allow default)(deny file-write*)(deny network*)"
    return ["sandbox-exec", "-p", profile, binary_path]


def _norm(s: str) -> str:
    """Normalize whitespace for output comparison."""
    return "\n".join(line.strip() for line in s.strip().splitlines())


# ── compiler discovery ─────────────────────────────────


# Standard search paths for common C++ compilers on macOS and Linux
_DEFAULT_COMPILER_CANDIDATES = [
    "g++", "g++-14", "g++-13", "g++-12", "g++-11",
    "clang++", "clang++-17", "clang++-16",
    # macOS Homebrew
    "/opt/homebrew/bin/g++-14", "/opt/homebrew/bin/g++-13",
    "/opt/homebrew/bin/g++", "/opt/homebrew/opt/gcc/bin/g++-14",
    # Intel Mac Homebrew
    "/usr/local/bin/g++-14", "/usr/local/bin/g++-13", "/usr/local/bin/g++",
    # Linux
    "/usr/bin/g++", "/usr/bin/clang++",
]

_HELLO_WORLD = b"#include <iostream>\nint main() { std::cout << \"ok\" << std::endl; return 0; }\n"

_cached_compiler: str | None = None
_cached_compiler_version: str = ""


def discover_compilers() -> list[dict[str, str]]:
    """Find all available C++ compilers and their versions. Returns list sorted by preference."""
    found: list[dict[str, str]] = []
    seen: set[str] = set()

    for candidate in _DEFAULT_COMPILER_CANDIDATES:
        path = shutil.which(candidate)
        if path is None:
            # Try absolute path directly
            if candidate.startswith("/") and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                path = candidate
            else:
                continue
        if path in seen:
            continue
        seen.add(path)

        version = _try_get_version(path)
        if version:
            found.append({"path": path, "version": version, "name": os.path.basename(path)})

    # Sort: prefer g++ over clang++, newer versions first
    def _sort_key(p: dict[str, str]) -> tuple[int, str]:
        name = p["name"]
        # g++ variants first
        is_gpp = 0 if "g++" in name else 1
        return (is_gpp, p["version"])

    found.sort(key=_sort_key)
    return found


def get_compiler() -> str | None:
    """Get a working compiler. Caches result after first discovery."""
    global _cached_compiler, _cached_compiler_version

    # Check env override first
    env_override = os.environ.get("EDP_CXX_COMPILER", "").strip()
    if env_override:
        if os.path.isfile(env_override) or shutil.which(env_override):
            version = _try_get_version(env_override)
            if version:
                _cached_compiler = env_override
                _cached_compiler_version = version
                return env_override

    # Use cached
    if _cached_compiler is not None:
        return _cached_compiler

    # Discover
    compilers = discover_compilers()
    if compilers:
        _cached_compiler = compilers[0]["path"]
        _cached_compiler_version = compilers[0]["version"]
        return _cached_compiler

    return None


def get_compiler_info() -> dict[str, str]:
    """Return current compiler info."""
    return {
        "path": _cached_compiler or "",
        "version": _cached_compiler_version or "",
    }


def _try_get_version(path: str) -> str:
    """Try to get compiler version string."""
    try:
        # First, verify it can actually compile
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "test.cpp")
            out = os.path.join(tmp, "test")
            with open(src, "wb") as f:
                f.write(_HELLO_WORLD)
            proc = subprocess.run(
                [path, "-std=c++17", "-O0", src, "-o", out],
                capture_output=True, timeout=10,
            )
            if proc.returncode != 0:
                return ""

        # Then get version
        proc = subprocess.run([path, "--version"], capture_output=True, timeout=5)
        first_line = proc.stdout.decode("utf-8", errors="replace").split("\n")[0].strip()
        # Also try stderr (g++ --version sometimes writes to stderr)
        if not first_line:
            first_line = proc.stderr.decode("utf-8", errors="replace").split("\n")[0].strip()
        return first_line[:100] if first_line else ""
    except Exception:
        return ""


def _find_gpp() -> str | None:
    """Find a working C++ compiler (deprecated, use get_compiler())."""
    return get_compiler()


def compile_cpp(code: str, binary_name: str = "sol") -> CompileResult:
    """Compile C++ code to a binary in a temp directory."""
    # Preflight audit
    err = audit_source(code)
    if err:
        return CompileResult(ok=False, error=err)

    gpp = get_compiler()
    if gpp is None:
        return CompileResult(ok=False, error="未找到 C++ 编译器（g++ 或 clang++），请安装 Xcode CLI Tools。")

    tmpdir = tempfile.mkdtemp(prefix="edp_cpp_")
    src_path = os.path.join(tmpdir, f"{binary_name}.cpp")
    bin_path = os.path.join(tmpdir, binary_name)

    with open(src_path, "w", encoding="utf-8") as f:
        f.write(code)

    try:
        proc = subprocess.run(
            [gpp, "-std=c++17", "-O2", "-Wall", src_path, "-o", bin_path],
            capture_output=True,
            timeout=COMPILE_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired:
        return CompileResult(ok=False, error=f"编译超时（>{COMPILE_TIMEOUT_SEC}s）")

    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[-2000:]
        shutil.rmtree(tmpdir, ignore_errors=True)
        return CompileResult(ok=False, error=f"编译失败:\n{err}")

    return CompileResult(ok=True, binary_path=bin_path)


def run_binary(binary_path: str, input_text: str = "",
               timeout_sec: int = RUN_TIMEOUT_SEC) -> RunResult:
    """Run a compiled binary with cwd isolation + resource limits + optional sandbox."""
    tmpdir = os.path.dirname(binary_path)
    cmd = _sandbox_cmd(binary_path)

    try:
        proc = subprocess.run(
            cmd,
            input=input_text.encode("utf-8", errors="replace") if input_text else b"",
            capture_output=True,
            timeout=timeout_sec,
            cwd=tmpdir,
            preexec_fn=_limit_resources,
        )
    except subprocess.TimeoutExpired:
        return RunResult(ok=False, timed_out=True, error=f"运行超时（>{timeout_sec}s）")

    stdout = proc.stdout.decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]
    stderr = proc.stderr.decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]

    if proc.returncode != 0:
        return RunResult(ok=False, stdout=stdout, stderr=stderr,
                         exit_code=proc.returncode,
                         error=f"运行时错误 (exit={proc.returncode})")

    return RunResult(ok=True, stdout=stdout, stderr=stderr, exit_code=0)


def cleanup(binary_path: str) -> None:
    """Remove the temp directory containing the binary."""
    tmpdir = os.path.dirname(binary_path)
    if os.path.isdir(tmpdir) and "edp_cpp_" in tmpdir:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ── sample testing ─────────────────────────────────────


def run_samples(code: str, samples: list[dict[str, str]]) -> list[SampleResult]:
    """Compile code and run against sample inputs."""
    if not samples:
        return []

    comp = compile_cpp(code)
    if not comp.ok:
        return [SampleResult(
            index=i + 1,
            input_text=s.get("input", ""),
            expected=s.get("output", ""),
            actual="",
            passed=False,
            error=comp.error,
        ) for i, s in enumerate(samples)]

    results: list[SampleResult] = []
    for i, s in enumerate(samples):
        inp = s.get("input", "")
        exp = s.get("output", "")
        run = run_binary(comp.binary_path, inp)

        actual = run.stdout if run.ok else run.error
        passed = run.ok and _norm(actual) == _norm(exp)

        results.append(SampleResult(
            index=i + 1,
            input_text=inp,
            expected=exp,
            actual=actual,
            passed=passed,
            error=run.error if not run.ok else "",
        ))

    cleanup(comp.binary_path)
    return results


# ── hack / 对拍 ────────────────────────────────────────


def run_hack(wa_code: str, brute_code: str, generator_code: str,
             max_rounds: int = 100) -> HackResult:
    """Run brute force 对拍 against WA solution."""

    # Compile all three
    comp_wa = compile_cpp(wa_code, "wa")
    if not comp_wa.ok:
        return HackResult(ok=False, brute_code=brute_code, generator_code=generator_code,
                          error=f"WA 代码编译失败: {comp_wa.error}")

    comp_brute = compile_cpp(brute_code, "brute")
    if not comp_brute.ok:
        cleanup(comp_wa.binary_path)
        return HackResult(ok=False, brute_code=brute_code, generator_code=generator_code,
                          error=f"暴力代码编译失败: {comp_brute.error}")

    comp_gen = compile_cpp(generator_code, "gen")
    if not comp_gen.ok:
        cleanup(comp_wa.binary_path)
        cleanup(comp_brute.binary_path)
        return HackResult(ok=False, brute_code=brute_code, generator_code=generator_code,
                          error=f"生成器编译失败: {comp_gen.error}")

    counterexample_input = ""
    wa_output = ""
    brute_output = ""
    first_fail = -1

    for rnd in range(1, max_rounds + 1):
        # Generate test data
        gen_run = run_binary(comp_gen.binary_path, timeout_sec=3)
        if not gen_run.ok:
            cleanup(comp_wa.binary_path)
            cleanup(comp_brute.binary_path)
            cleanup(comp_gen.binary_path)
            return HackResult(ok=False, brute_code=brute_code, generator_code=generator_code,
                              round_count=rnd,
                              error=f"生成器在第 {rnd} 轮失败: {gen_run.error}")

        test_input = gen_run.stdout

        # Run brute
        br_run = run_binary(comp_brute.binary_path, test_input)
        if not br_run.ok:
            cleanup(comp_wa.binary_path)
            cleanup(comp_brute.binary_path)
            cleanup(comp_gen.binary_path)
            return HackResult(ok=False, brute_code=brute_code, generator_code=generator_code,
                              round_count=rnd,
                              error=f"暴力解在第 {rnd} 轮失败: {br_run.error}")

        # Run WA
        wa_run = run_binary(comp_wa.binary_path, test_input)
        if not wa_run.ok:
            cleanup(comp_wa.binary_path)
            cleanup(comp_brute.binary_path)
            cleanup(comp_gen.binary_path)
            return HackResult(ok=False, brute_code=brute_code, generator_code=generator_code,
                              round_count=rnd,
                              error=f"WA 代码在第 {rnd} 轮崩溃: {wa_run.error}")

        # Compare
        if _norm(wa_run.stdout) != _norm(br_run.stdout):
            first_fail = rnd
            counterexample_input = test_input
            wa_output = wa_run.stdout
            brute_output = br_run.stdout
            break

    cleanup(comp_wa.binary_path)
    cleanup(comp_brute.binary_path)
    cleanup(comp_gen.binary_path)

    return HackResult(
        ok=True,
        round_count=max_rounds if first_fail < 0 else first_fail,
        first_fail=first_fail,
        counterexample_input=counterexample_input,
        wa_output=wa_output,
        brute_output=brute_output,
        brute_code=brute_code,
        generator_code=generator_code,
    )
