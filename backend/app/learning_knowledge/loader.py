"""Knowledge base loader for the learning knowledge system.

Reads the file-based knowledge base from `learning_knowledge/`,
validates structure completeness, and exposes APIs for course lookup.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# ── Knowledge base root ────────────────────────────────

_KB_ROOT = Path(__file__).resolve().parent


# ── Data classes ────────────────────────────────────────

class ModuleInfo:
    __slots__ = (
        "module_id", "title", "difficulty", "estimated_minutes",
        "prerequisites", "learning_objectives", "keywords", "source_refs", "path",
    )

    def __init__(self, data: dict[str, Any], module_path: Path) -> None:
        self.module_id: str = data["module_id"]
        self.title: str = data["title"]
        self.difficulty: str = data.get("difficulty", "basic")
        self.estimated_minutes: int = data.get("estimated_minutes", 60)
        self.prerequisites: list[str] = data.get("prerequisites", [])
        self.learning_objectives: list[str] = data.get("learning_objectives", [])
        self.keywords: list[str] = data.get("keywords", [])
        self.source_refs: list[str] = data.get("source_refs", [])
        self.path = module_path

    def concept_count(self) -> int:
        concepts = _load_json_safe(self.path / "concepts.json")
        return len(concepts) if isinstance(concepts, list) else 0

    def exercise_count(self) -> int:
        exercises = _load_json_safe(self.path / "exercises.json")
        return len(exercises) if isinstance(exercises, list) else 0


class CourseInfo:
    __slots__ = (
        "course_id", "title", "version", "summary",
        "target_learners", "module_ids", "course_path",
    )

    def __init__(self, data: dict[str, Any], course_path: Path) -> None:
        self.course_id: str = data["course_id"]
        self.title: str = data["title"]
        self.version: str = data.get("version", "0.1.0")
        self.summary: str = data.get("summary", "")
        self.target_learners: list[str] = data.get("target_learners", [])
        self.module_ids: list[str] = data.get("modules", [])
        self.course_path = course_path

    @property
    def module_count(self) -> int:
        return len(self.module_ids)


# ── Internal helpers ────────────────────────────────────

def _load_json_safe(path: Path) -> Any:
    """Load a JSON file, returning None if missing or malformed."""
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _read_text_safe(path: Path) -> str | None:
    """Read a text file, returning None if missing or unreadable."""
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
        return text if text.strip() else None
    except OSError:
        return None


def _required_files() -> list[str]:
    return ["manifest.json", "lecture.md", "concepts.json", "exercises.json", "lab.md"]


# ── Loader ──────────────────────────────────────────────

class KnowledgeBase:
    """Loaded and validated knowledge base instance."""

    def __init__(self) -> None:
        self.courses: dict[str, CourseInfo] = {}
        self.modules: dict[str, ModuleInfo] = {}  # keyed by module_id
        self.errors: list[str] = []

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0

    def load_all(self) -> KnowledgeBase:
        """Scan _KB_ROOT for courses, load and validate each."""
        self.errors.clear()
        self.courses.clear()
        self.modules.clear()

        if not _KB_ROOT.is_dir():
            self.errors.append(f"Knowledge base root not found: {_KB_ROOT}")
            return self

        for course_dir in sorted(_KB_ROOT.iterdir()):
            if not course_dir.is_dir():
                continue
            if course_dir.name.startswith(".") or course_dir.name.startswith("_"):
                continue
            if not (course_dir / "course.json").is_file():
                self.errors.append(f"[{course_dir.name}] Missing course.json")
                continue
            self._load_course(course_dir)

        return self

    def _load_course(self, course_dir: Path) -> None:
        course_data = _load_json_safe(course_dir / "course.json")
        if not isinstance(course_data, dict):
            self.errors.append(f"[{course_dir.name}] course.json is not a valid JSON object")
            return

        course = CourseInfo(course_data, course_dir)

        modules_dir = course_dir / "modules"
        if not modules_dir.is_dir():
            self.errors.append(f"[{course.course_id}] modules directory missing")
            return

        loaded_ids: list[str] = []
        for module_id in course.module_ids:
            module_path = modules_dir / module_id
            if not module_path.is_dir():
                self.errors.append(f"[{course.course_id}] Module directory missing: {module_id}")
                continue

            # Check required files
            missing = [f for f in _required_files() if not (module_path / f).is_file()]
            if missing:
                self.errors.append(
                    f"[{course.course_id}/{module_id}] Missing files: {', '.join(missing)}"
                )
                continue

            # Load manifest
            manifest = _load_json_safe(module_path / "manifest.json")
            if not isinstance(manifest, dict):
                self.errors.append(
                    f"[{course.course_id}/{module_id}] manifest.json is not a valid JSON object"
                )
                continue

            if manifest.get("module_id") != module_id:
                self.errors.append(
                    f"[{course.course_id}/{module_id}] manifest.module_id mismatch: "
                    f"expected '{module_id}', got '{manifest.get('module_id')}'"
                )

            # Validate manifest difficulty enum
            valid_difficulties = {"basic", "intermediate", "advanced"}
            if manifest.get("difficulty") not in valid_difficulties:
                self.errors.append(
                    f"[{course.course_id}/{module_id}] manifest.difficulty "
                    f"'{manifest.get('difficulty')}' not in {valid_difficulties}"
                )

            # Validate manifest source_refs exist in course sources.json
            course_sources = _load_json_safe(course_dir / "sources.json")
            valid_source_ids: set[str] = set()
            if isinstance(course_sources, list):
                for src in course_sources:
                    if isinstance(src, dict) and src.get("source_id"):
                        valid_source_ids.add(src["source_id"])
            for ref in manifest.get("source_refs", []):
                if ref not in valid_source_ids:
                    self.errors.append(
                        f"[{course.course_id}/{module_id}] manifest.source_refs "
                        f"'{ref}' not found in sources.json"
                    )

            # Validate concepts count and content
            concepts = _load_json_safe(module_path / "concepts.json")
            concept_ids: set[str] = set()
            if isinstance(concepts, list):
                if len(concepts) < 5:
                    self.errors.append(
                        f"[{course.course_id}/{module_id}] concepts.json has {len(concepts)} "
                        f"concepts, minimum 5 required"
                    )
                for ci, c in enumerate(concepts):
                    if not isinstance(c, dict):
                        self.errors.append(
                            f"[{course.course_id}/{module_id}] concepts.json[{ci}] is not an object"
                        )
                        continue
                    cid = c.get("concept_id", "")
                    if not cid:
                        self.errors.append(
                            f"[{course.course_id}/{module_id}] concepts.json[{ci}] missing concept_id"
                        )
                    else:
                        concept_ids.add(cid)
                    # Validate concept source_refs
                    for ref in c.get("source_refs", []):
                        if ref not in valid_source_ids:
                            self.errors.append(
                                f"[{course.course_id}/{module_id}] concepts.json[{ci}] "
                                f"source_refs '{ref}' not found in sources.json"
                            )
            else:
                self.errors.append(
                    f"[{course.course_id}/{module_id}] concepts.json is not a valid JSON array"
                )

            # Validate exercises count and content
            valid_exercise_levels = {"basic", "standard", "transfer"}
            valid_exercise_types = {"short_answer", "single_choice", "code_reading", "code_writing", "proof"}
            exercises = _load_json_safe(module_path / "exercises.json")
            if isinstance(exercises, list):
                if len(exercises) < 6:
                    self.errors.append(
                        f"[{course.course_id}/{module_id}] exercises.json has {len(exercises)} "
                        f"exercises, minimum 6 required"
                    )
                for ei, ex in enumerate(exercises):
                    if not isinstance(ex, dict):
                        self.errors.append(
                            f"[{course.course_id}/{module_id}] exercises.json[{ei}] is not an object"
                        )
                        continue
                    # Validate level enum
                    ex_level = ex.get("level", "")
                    if ex_level not in valid_exercise_levels:
                        self.errors.append(
                            f"[{course.course_id}/{module_id}] exercises.json[{ei}] "
                            f"level '{ex_level}' not in {valid_exercise_levels}"
                        )
                    # Validate type enum
                    ex_type = ex.get("type", "")
                    if ex_type not in valid_exercise_types:
                        self.errors.append(
                            f"[{course.course_id}/{module_id}] exercises.json[{ei}] "
                            f"type '{ex_type}' not in {valid_exercise_types}"
                        )
                    # Validate target_concepts reference existing concepts
                    for tc in ex.get("target_concepts", []):
                        if tc not in concept_ids:
                            self.errors.append(
                                f"[{course.course_id}/{module_id}] exercises.json[{ei}] "
                                f"target_concepts '{tc}' does not match any concept_id"
                            )
                    # Validate exercise source_refs
                    for ref in ex.get("source_refs", []):
                        if ref not in valid_source_ids:
                            self.errors.append(
                                f"[{course.course_id}/{module_id}] exercises.json[{ei}] "
                                f"source_refs '{ref}' not found in sources.json"
                            )
            else:
                self.errors.append(
                    f"[{course.course_id}/{module_id}] exercises.json is not a valid JSON array"
                )

            # Validate lecture.md required headings
            lecture_text = _read_text_safe(module_path / "lecture.md")
            if lecture_text is not None:
                required_headings = [
                    "## 学习目标", "## 知识地图", "## 核心讲解",
                    "## 典型例子", "## 易错点", "## 自测问题", "## 与后续模块的关系",
                ]
                missing_headings = [h for h in required_headings if h not in lecture_text]
                if missing_headings:
                    self.errors.append(
                        f"[{course.course_id}/{module_id}] lecture.md missing headings: "
                        f"{', '.join(missing_headings)}"
                    )
            else:
                self.errors.append(
                    f"[{course.course_id}/{module_id}] lecture.md is empty or unreadable"
                )

            # Validate lab.md required headings
            lab_text = _read_text_safe(module_path / "lab.md")
            if lab_text is not None:
                required_lab_headings = [
                    "## 任务目标", "## 输入输出", "## 实现步骤",
                    "## 提交物", "## 反思问题",
                ]
                missing_lab = [h for h in required_lab_headings if h not in lab_text]
                if missing_lab:
                    self.errors.append(
                        f"[{course.course_id}/{module_id}] lab.md missing headings: "
                        f"{', '.join(missing_lab)}"
                    )
            else:
                self.errors.append(
                    f"[{course.course_id}/{module_id}] lab.md is empty or unreadable"
                )

            module = ModuleInfo(manifest, module_path)
            self.modules[module.module_id] = module
            loaded_ids.append(module_id)

        course.module_ids = loaded_ids  # keep only successfully loaded
        self.courses[course.course_id] = course

    # ── Query API ───────────────────────────────────────

    def get_course(self, course_id: str) -> CourseInfo | None:
        return self.courses.get(course_id)

    def get_module(self, module_id: str) -> ModuleInfo | None:
        return self.modules.get(module_id)

    def course_ids(self) -> list[str]:
        return list(self.courses.keys())

    def module_ids(self) -> list[str]:
        return list(self.modules.keys())

    def read_module_file(self, module_id: str, filename: str) -> str | None:
        module = self.modules.get(module_id)
        if module is None:
            return None
        file_path = module.path / filename
        if not file_path.is_file():
            return None
        try:
            return file_path.read_text(encoding="utf-8")
        except OSError:
            return None

    def concept_list(self, module_id: str) -> list[dict[str, Any]]:
        module = self.modules.get(module_id)
        if module is None:
            return []
        concepts = _load_json_safe(module.path / "concepts.json")
        return concepts if isinstance(concepts, list) else []

    def exercise_list(self, module_id: str) -> list[dict[str, Any]]:
        module = self.modules.get(module_id)
        if module is None:
            return []
        exercises = _load_json_safe(module.path / "exercises.json")
        return exercises if isinstance(exercises, list) else []

    def source_list(self, course_id: str) -> list[dict[str, Any]]:
        course = self.courses.get(course_id)
        if course is None:
            return []
        sources = _load_json_safe(course.course_path / "sources.json")
        return sources if isinstance(sources, list) else []

    # ── Stats ───────────────────────────────────────────

    def stats(self) -> dict[str, Any]:
        total_concepts = sum(m.concept_count() for m in self.modules.values())
        total_exercises = sum(m.exercise_count() for m in self.modules.values())
        total_labs = len([m for m in self.modules.values() if (m.path / "lab.md").is_file()])
        return {
            "courses": len(self.courses),
            "modules": len(self.modules),
            "total_concepts": total_concepts,
            "total_exercises": total_exercises,
            "total_labs": total_labs,
            "errors": len(self.errors),
        }


# ── Singleton ───────────────────────────────────────────

_kb: KnowledgeBase | None = None


def load_knowledge_base() -> KnowledgeBase:
    """Load (or return cached) knowledge base. Re-validates on every call."""
    global _kb
    kb = KnowledgeBase()
    kb.load_all()
    _kb = kb
    return kb


def get_knowledge_base() -> KnowledgeBase | None:
    return _kb


# ── FastAPI integration helper ──────────────────────────

def get_kb_for_request() -> KnowledgeBase:
    """Dependency to inject KB into FastAPI routes."""
    kb = get_knowledge_base()
    if kb is None:
        kb = load_knowledge_base()
    return kb
