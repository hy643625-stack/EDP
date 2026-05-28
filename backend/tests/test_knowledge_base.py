"""Tests for the knowledge base loader."""
from __future__ import annotations

import pytest
from app.learning_knowledge.loader import KnowledgeBase, load_knowledge_base


@pytest.fixture(scope="module")
def kb() -> KnowledgeBase:
    return load_knowledge_base()


class TestKnowledgeBaseStructure:
    def test_root_exists(self, kb: KnowledgeBase) -> None:
        assert len(kb.errors) == 0, f"KB errors: {kb.errors}"

    def test_at_least_one_course(self, kb: KnowledgeBase) -> None:
        assert len(kb.courses) >= 1, "Expected at least 1 course"

    def test_data_structures_course_loaded(self, kb: KnowledgeBase) -> None:
        assert "data_structures" in kb.courses, "data_structures course not found"

    def test_course_has_eight_modules(self, kb: KnowledgeBase) -> None:
        course = kb.get_course("data_structures")
        assert course is not None
        assert len(course.module_ids) == 8, f"Expected 8 modules, got {len(course.module_ids)}"

    def test_all_module_dirs_exist(self, kb: KnowledgeBase) -> None:
        expected = [
            "ds-01-complexity", "ds-02-linear-list", "ds-03-stack-queue",
            "ds-04-tree", "ds-05-hash-search", "ds-06-graph",
            "ds-07-sorting", "ds-08-integrated-project",
        ]
        for mid in expected:
            assert mid in kb.modules, f"Module not loaded: {mid}"


class TestModuleValidation:
    def test_each_module_has_minimum_concepts(self, kb: KnowledgeBase) -> None:
        for mid, module in kb.modules.items():
            count = module.concept_count()
            assert count >= 5, f"{mid}: expected >= 5 concepts, got {count}"

    def test_each_module_has_minimum_exercises(self, kb: KnowledgeBase) -> None:
        for mid, module in kb.modules.items():
            count = module.exercise_count()
            assert count >= 6, f"{mid}: expected >= 6 exercises, got {count}"

    def test_total_concepts_exceeds_40(self, kb: KnowledgeBase) -> None:
        total = sum(m.concept_count() for m in kb.modules.values())
        assert total >= 40, f"Total concepts {total} < 40"

    def test_total_exercises_exceeds_48(self, kb: KnowledgeBase) -> None:
        total = sum(m.exercise_count() for m in kb.modules.values())
        assert total >= 48, f"Total exercises {total} < 48"

    def test_each_module_has_source_refs(self, kb: KnowledgeBase) -> None:
        for mid, module in kb.modules.items():
            assert len(module.source_refs) > 0, f"{mid}: missing source_refs"

    def test_each_module_has_learning_objectives(self, kb: KnowledgeBase) -> None:
        for mid, module in kb.modules.items():
            assert len(module.learning_objectives) >= 2, \
                f"{mid}: expected >= 2 learning_objectives, got {len(module.learning_objectives)}"

    def test_each_module_has_difficulty(self, kb: KnowledgeBase) -> None:
        valid = {"basic", "intermediate", "advanced"}
        for mid, module in kb.modules.items():
            assert module.difficulty in valid, \
                f"{mid}: invalid difficulty '{module.difficulty}'"


class TestFileAccess:
    def test_read_lecture_for_all_modules(self, kb: KnowledgeBase) -> None:
        for mid in kb.modules:
            content = kb.read_module_file(mid, "lecture.md")
            assert content is not None, f"{mid}: lecture.md not readable"
            assert len(content.strip()) > 100, f"{mid}: lecture.md too short ({len(content)} chars)"

    def test_read_lab_for_all_modules(self, kb: KnowledgeBase) -> None:
        for mid in kb.modules:
            content = kb.read_module_file(mid, "lab.md")
            assert content is not None, f"{mid}: lab.md not readable"
            assert len(content.strip()) > 100, f"{mid}: lab.md too short ({len(content)} chars)"

    def test_source_list_available(self, kb: KnowledgeBase) -> None:
        sources = kb.source_list("data_structures")
        assert len(sources) >= 3, f"Expected >= 3 sources, got {len(sources)}"


class TestDeepValidation:
    """Checks the enhanced loader validation rules."""

    def test_all_exercise_levels_valid(self, kb: KnowledgeBase) -> None:
        valid = {"basic", "standard", "transfer"}
        for mid in kb.modules:
            for ex in kb.exercise_list(mid):
                level = ex.get("level", "")
                assert level in valid, f"{mid}/{ex.get('exercise_id')}: level '{level}' invalid"

    def test_all_exercise_types_valid(self, kb: KnowledgeBase) -> None:
        valid = {"short_answer", "single_choice", "code_reading", "code_writing", "proof"}
        for mid in kb.modules:
            for ex in kb.exercise_list(mid):
                etype = ex.get("type", "")
                assert etype in valid, f"{mid}/{ex.get('exercise_id')}: type '{etype}' invalid"

    def test_all_exercise_target_concepts_exist(self, kb: KnowledgeBase) -> None:
        for mid in kb.modules:
            concept_ids = {c["concept_id"] for c in kb.concept_list(mid)}
            for ex in kb.exercise_list(mid):
                for tc in ex.get("target_concepts", []):
                    assert tc in concept_ids, \
                        f"{mid}/{ex.get('exercise_id')}: target_concept '{tc}' not found"

    def test_all_source_refs_valid(self, kb: KnowledgeBase) -> None:
        """Every source_refs value must exist in sources.json."""
        sources = kb.source_list("data_structures")
        valid_ids = {s["source_id"] for s in sources if "source_id" in s}
        for mid, module in kb.modules.items():
            for ref in module.source_refs:
                assert ref in valid_ids, f"{mid}: manifest source_ref '{ref}' not in sources.json"
            for c in kb.concept_list(mid):
                for ref in c.get("source_refs", []):
                    assert ref in valid_ids, \
                        f"{mid}/{c.get('concept_id')}: source_ref '{ref}' not in sources.json"
            for ex in kb.exercise_list(mid):
                for ref in ex.get("source_refs", []):
                    assert ref in valid_ids, \
                        f"{mid}/{ex.get('exercise_id')}: source_ref '{ref}' not in sources.json"

    def test_lecture_required_headings(self, kb: KnowledgeBase) -> None:
        required = ["## 学习目标", "## 知识地图", "## 核心讲解",
                     "## 典型例子", "## 易错点", "## 自测问题", "## 与后续模块的关系"]
        for mid in kb.modules:
            content = kb.read_module_file(mid, "lecture.md")
            assert content is not None, f"{mid}: lecture.md not found"
            for h in required:
                assert h in content, f"{mid}: lecture.md missing heading '{h}'"

    def test_lab_required_headings(self, kb: KnowledgeBase) -> None:
        required = ["## 任务目标", "## 输入输出", "## 实现步骤",
                     "## 提交物", "## 反思问题"]
        for mid in kb.modules:
            content = kb.read_module_file(mid, "lab.md")
            assert content is not None, f"{mid}: lab.md not found"
            for h in required:
                assert h in content, f"{mid}: lab.md missing heading '{h}'"


class TestStats:
    def test_stats_report(self, kb: KnowledgeBase) -> None:
        stats = kb.stats()
        assert stats["errors"] == 0, f"KB has {stats['errors']} errors"
        assert stats["courses"] >= 1
        assert stats["modules"] >= 8
        assert stats["total_labs"] >= 8
