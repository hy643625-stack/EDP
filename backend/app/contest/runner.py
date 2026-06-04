"""Safe C++ compilation and execution for contest diagnosis."""

from __future__ import annotations

import os
import subprocess
import tempfile
import shutil
from dataclasses import dataclass, field
from typing import Any

COMPILE_TIMEOUT_SEC = 15
RUN_TIMEOUT_SEC = 5
MAX_OUTPUT_BYTES = 100_000


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


# ── low-level compile & run ────────────────────────────


def _norm(s: str) -> str:
    """Normalize whitespace for output comparison."""
    return "\n".join(line.strip() for line in s.strip().splitlines())


def _find_gpp() -> str | None:
    """Find a working C++ compiler."""
    for name in ("g++", "g++-14", "g++-13", "g++-12", "clang++"):
        if shutil.which(name):
            return name
    return None


def compile_cpp(code: str, binary_name: str = "sol") -> CompileResult:
    """Compile C++ code to a binary in a temp directory."""
    gpp = _find_gpp()
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
    """Run a compiled binary with optional input."""
    try:
        proc = subprocess.run(
            [binary_path],
            input=input_text.encode("utf-8", errors="replace") if input_text else b"",
            capture_output=True,
            timeout=timeout_sec,
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
