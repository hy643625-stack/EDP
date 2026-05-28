from __future__ import annotations

from fastapi import Depends, Request

from app.db import Database
from app.learning_knowledge.loader import KnowledgeBase
from app.repositories.focus_repository import FocusRepository
from app.repositories.home_repository import HomeRepository
from app.repositories.learning_repository import LearningRepository
from app.repositories.record_repository import RecordRepository
from app.repositories.task_repository import TaskRepository
from app.repositories.todo_repository import TodoRepository
from app.services.ai_settings_service import AiSettingsService
from app.services.ai_summary_service import AiSummaryService
from app.services.learning_agent_service import LearningAgentService
from app.services import FocusService, RecordService, TaskService, TodoService
from app.services.home_service import HomeService


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_ai_settings_service(request: Request) -> AiSettingsService:
    return request.app.state.ai_settings_service


def get_ai_summary_service(
    ai_settings_service: AiSettingsService = Depends(get_ai_settings_service),
    db: Database = Depends(get_db),
) -> AiSummaryService:
    task_repo = TaskRepository(db)
    home_service = HomeService(HomeRepository(db), task_repo)
    return AiSummaryService(home_service, ai_settings_service)


def get_knowledge_base(request: Request) -> KnowledgeBase:
    return request.app.state.knowledge_base


def get_learning_agent_service(
    ai_settings_service: AiSettingsService = Depends(get_ai_settings_service),
    kb: KnowledgeBase = Depends(get_knowledge_base),
    db: Database = Depends(get_db),
) -> LearningAgentService:
    return LearningAgentService(ai_settings_service, kb, repo=LearningRepository(db))


def get_task_service(db: Database = Depends(get_db)) -> TaskService:
    return TaskService(TaskRepository(db))


def get_record_service(db: Database = Depends(get_db)) -> RecordService:
    task_repo = TaskRepository(db)
    return RecordService(RecordRepository(db), task_repo)


def get_todo_service(db: Database = Depends(get_db)) -> TodoService:
    task_repo = TaskRepository(db)
    return TodoService(TodoRepository(db), task_repo)


def get_focus_service(db: Database = Depends(get_db)) -> FocusService:
    task_repo = TaskRepository(db)
    return FocusService(FocusRepository(db), task_repo)


def get_home_service(db: Database = Depends(get_db)) -> HomeService:
    task_repo = TaskRepository(db)
    return HomeService(HomeRepository(db), task_repo)
