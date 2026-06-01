from .ai_settings import router as ai_settings_router
from .contest import router as contest_router
from .focus import router as focus_router
from .home import router as home_router
from .learning import router as learning_router
from .misc import router as misc_router
from .records import router as records_router
from .tasks import router as tasks_router
from .todos import router as todos_router

__all__ = [
    "ai_settings_router",
    "contest_router",
    "tasks_router",
    "records_router",
    "todos_router",
    "focus_router",
    "home_router",
    "learning_router",
    "misc_router",
]
