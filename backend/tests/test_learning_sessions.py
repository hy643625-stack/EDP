"""Tests for Phase 2: learning sessions, profile versions, agent pipeline."""
from __future__ import annotations

import os
os.environ.setdefault("EVERYDAYPERFECT_SKIP_DEFAULT_APP", "1")

import pytest
from app.config import Settings
from app.main import create_app
from app.repositories.learning_repository import LearningRepository
from app.services.learning_agent_service import LearningAgentService


@pytest.fixture(scope="module")
def service() -> LearningAgentService:
    import tempfile, os, atexit
    db_file = os.path.join(tempfile.gettempdir(), "edp_test_sessions.db")
    settings = Settings(db_path=db_file, cors_origins=("http://localhost:5173",))
    app = create_app(settings)
    kb = app.state.knowledge_base
    repo = LearningRepository(app.state.db)
    svc = LearningAgentService(app.state.ai_settings_service, kb, repo=repo)

    def cleanup():
        if os.path.exists(db_file):
            os.remove(db_file)
    atexit.register(cleanup)
    return svc


class TestSessionLifecycle:
    def test_create_session_generates_profile_v1(self, service: LearningAgentService) -> None:
        result = service.create_learning_session(
            "data_structures", "我在复习数据结构，每天学1小时", "期末考试"
        )
        assert "session" in result
        assert result["session"]["id"]
        assert result["profile_version"] == 1
        assert "dimensions" in result["profile"]

    def test_update_profile_creates_new_version(self, service: LearningAgentService) -> None:
        r1 = service.create_learning_session(
            "data_structures", "我在复习数据结构，基础一般", "考试提分"
        )
        sid = r1["session"]["id"]
        r2 = service.update_session_profile(sid, "我做了套题，树这块错很多")
        assert r2["profile_version"] == 2

    def test_unknown_session_returns_404(self, service: LearningAgentService) -> None:
        from app.errors import ApiError
        with pytest.raises(ApiError) as exc:
            service.update_session_profile("nonexistent-id", "some text")
        assert exc.value.status_code == 404

    def test_list_sessions_returns_recent(self, service: LearningAgentService) -> None:
        sessions = service.list_sessions()
        assert isinstance(sessions, list)
        # Should have at least the sessions created in previous tests
        assert len(sessions) >= 1


class TestAgentPipeline:
    def test_pipeline_records_agent_runs(self, service: LearningAgentService) -> None:
        r = service.create_learning_session(
            "data_structures", "我在准备数据结构期末考试，基础一般，树和图比较薄弱", "考试"
        )
        sid = r["session"]["id"]
        pkg = service.generate_session_package(sid)
        agent_runs = pkg["package"]["agent_runs"]
        assert len(agent_runs) >= 6, f"Expected >=6 agent_runs, got {len(agent_runs)}"
        agent_ids = {run["agent_id"] for run in agent_runs}
        assert "profiler" in agent_ids
        assert "planner" in agent_ids
        assert "explainer" in agent_ids
        assert "practice" in agent_ids
        assert "curator" in agent_ids
        assert "coach" in agent_ids

    def test_each_resource_has_source_refs_and_safety_review(self, service: LearningAgentService) -> None:
        r = service.create_learning_session(
            "data_structures", "我需要系统学习数据结构", "系统学习"
        )
        sid = r["session"]["id"]
        pkg = service.generate_session_package(sid)
        for resource in pkg["package"]["resources"]:
            assert "source_refs" in resource, f"{resource['resource_id']} missing source_refs"
            assert "safety_review" in resource, f"{resource['resource_id']} missing safety_review"
            sr = resource["safety_review"]
            assert "grounding_passed" in sr
            assert sr["grounding_passed"] is True, \
                f"{resource['resource_id']} grounding_passed should be True"

    def test_session_detail_includes_all_data(self, service: LearningAgentService) -> None:
        r = service.create_learning_session(
            "data_structures", "测试会话详情功能是否完整可用", "测试"
        )
        sid = r["session"]["id"]
        service.generate_session_package(sid)
        detail = service.get_session_detail(sid)
        assert len(detail.get("profile_versions", [])) >= 1
        assert len(detail.get("agent_runs", [])) >= 6
        assert detail.get("latest_package") is not None


class TestBackwardCompat:
    def test_old_profile_endpoint_still_works(self, service: LearningAgentService) -> None:
        result = service.build_profile("data_structures", "准备考试中，基础一般需要系统复习")
        assert "profile" in result
        assert "dimensions" in result["profile"]

    def test_old_resource_package_endpoint_still_works(self, service: LearningAgentService) -> None:
        result = service.generate_learning_package("data_structures", "准备考试中，需要系统复习数据结构")
        assert "package" in result
        assert result["package"]["resource_count"] >= 1
