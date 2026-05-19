from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from app.errors import ApiError
from app.services.ai_settings_service import AiSettingsService

LEARNING_PRIVACY_NOTICE = (
    "启用云端 AI 后，学习对话、目标和资源包摘要可能会发送到所选模型服务进行处理。"
    "若不希望上传数据，请关闭 AI 或使用本地模型。"
)

LEARNING_AGENTS: list[dict[str, Any]] = [
    {"agent_id": "profiler", "name": "学习画像智能体", "responsibility": "提炼目标、基础、偏好与风险。"},
    {"agent_id": "planner", "name": "路径规划智能体", "responsibility": "拆解阶段任务与学习路径。"},
    {"agent_id": "explainer", "name": "课程讲解智能体", "responsibility": "生成讲解提纲和难点说明。"},
    {"agent_id": "practice", "name": "练习设计智能体", "responsibility": "生成分层练习与自测问题。"},
    {"agent_id": "curator", "name": "资源策展智能体", "responsibility": "组合脑图、阅读指南、案例任务。"},
    {"agent_id": "coach", "name": "督学教练智能体", "responsibility": "输出节奏建议、风险提醒和复盘动作。"},
]

PROFILE_DIMENSION_CATALOG: list[dict[str, str]] = [
    {"key": "baseline", "label": "基础水平"},
    {"key": "goal", "label": "目标导向"},
    {"key": "schedule", "label": "时间带宽"},
    {"key": "style", "label": "学习偏好"},
    {"key": "practice", "label": "练习方式"},
    {"key": "pace", "label": "节奏容忍度"},
    {"key": "risk", "label": "风险因子"},
    {"key": "support", "label": "支持策略"},
]

COURSE_CATALOG: list[dict[str, Any]] = [
    {
        "course_id": "python_programming",
        "title": "Python 程序设计",
        "category": "编程基础",
        "difficulty": "入门到进阶",
        "summary": "覆盖语法、函数、数据结构、文件处理、面向对象与小项目实践。",
        "tags": ["编程", "自动化", "项目"],
        "modules": [
            {"module_id": "py-01", "title": "基础语法", "core_points": ["变量", "数据类型", "输入输出"], "outcome": "能写简单脚本。"},
            {"module_id": "py-02", "title": "流程与函数", "core_points": ["分支", "循环", "函数"], "outcome": "能封装重复逻辑。"},
            {"module_id": "py-03", "title": "列表字典集合", "core_points": ["序列", "映射", "推导式"], "outcome": "能组织中等规模数据。"},
            {"module_id": "py-04", "title": "文件与异常", "core_points": ["文件读写", "JSON", "异常处理"], "outcome": "能完成稳定的数据读写。"},
            {"module_id": "py-05", "title": "面向对象", "core_points": ["类", "继承", "组合"], "outcome": "能做基础对象建模。"},
            {"module_id": "py-06", "title": "项目实战", "core_points": ["模块化", "调试", "脚本实战"], "outcome": "能完成小型项目。"},
        ],
    },
    {
        "course_id": "data_structures",
        "title": "数据结构与算法",
        "category": "计算机核心课",
        "difficulty": "中级",
        "summary": "围绕线性结构、树、图、查找排序和复杂度分析建立课程主线。",
        "tags": ["算法", "面试", "计算思维"],
        "modules": [
            {"module_id": "ds-01", "title": "复杂度与 ADT", "core_points": ["时间复杂度", "空间复杂度", "抽象数据类型"], "outcome": "能分析算法开销。"},
            {"module_id": "ds-02", "title": "线性表栈队列", "core_points": ["顺序表", "链表", "栈队列"], "outcome": "能手写基本操作。"},
            {"module_id": "ds-03", "title": "树与二叉树", "core_points": ["遍历", "递归", "哈夫曼树"], "outcome": "能分析树形问题。"},
            {"module_id": "ds-04", "title": "图结构", "core_points": ["DFS/BFS", "最短路", "最小生成树"], "outcome": "能用图模型解题。"},
            {"module_id": "ds-05", "title": "查找结构", "core_points": ["二叉排序树", "AVL", "哈希"], "outcome": "能比较查找方案。"},
            {"module_id": "ds-06", "title": "排序与综合应用", "core_points": ["归并", "快排", "题型串联"], "outcome": "能完成综合题。"},
        ],
    },
    {
        "course_id": "advanced_math",
        "title": "高等数学",
        "category": "数学基础课",
        "difficulty": "基础到强化",
        "summary": "覆盖极限、导数、积分、多元微积分与级数，适合期末与考研复盘。",
        "tags": ["数学", "考研", "理论"],
        "modules": [
            {"module_id": "am-01", "title": "极限与连续", "core_points": ["函数", "极限", "连续"], "outcome": "能判断连续与极限行为。"},
            {"module_id": "am-02", "title": "导数与微分", "core_points": ["导数定义", "求导法则", "微分"], "outcome": "能完成一元求导。"},
            {"module_id": "am-03", "title": "导数应用", "core_points": ["单调性", "极值", "中值定理"], "outcome": "能分析函数图像。"},
            {"module_id": "am-04", "title": "积分基础", "core_points": ["换元", "分部积分", "定积分"], "outcome": "能处理核心积分题。"},
            {"module_id": "am-05", "title": "多元微积分", "core_points": ["偏导", "全微分", "极值"], "outcome": "能分析二元函数。"},
            {"module_id": "am-06", "title": "级数与综合复盘", "core_points": ["收敛性", "幂级数", "综合题"], "outcome": "能完成综合复盘。"},
        ],
    },
]

COURSE_INDEX = {course["course_id"]: course for course in COURSE_CATALOG}


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = text.strip()
    if not raw:
        raise ValueError("empty model response")
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        parsed = json.loads(raw[start : end + 1])
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("model response is not valid JSON")


def _contains_any(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


class LearningAgentService:
    def __init__(self, ai_settings_service: AiSettingsService) -> None:
        self.ai_settings_service = ai_settings_service

    def get_workbench_payload(self) -> dict[str, Any]:
        return {
            "courses": [self._serialize_course_summary(course) for course in COURSE_CATALOG],
            "agents": copy.deepcopy(LEARNING_AGENTS),
            "profile_dimensions": copy.deepcopy(PROFILE_DIMENSION_CATALOG),
            "privacy_notice": LEARNING_PRIVACY_NOTICE,
            "runtime": self.ai_settings_service.get_execution_plan(),
            "feature_flags": {
                "profile_builder": True,
                "resource_package": True,
                "learning_path": True,
                "evaluation_panel": True,
            },
        }

    def _serialize_course_summary(self, course: dict[str, Any]) -> dict[str, Any]:
        return {
            "course_id": course["course_id"],
            "title": course["title"],
            "category": course["category"],
            "difficulty": course["difficulty"],
            "summary": course["summary"],
            "tags": list(course["tags"]),
            "module_count": len(course["modules"]),
            "modules": [
                {
                    "module_id": module["module_id"],
                    "title": module["title"],
                    "core_points": list(module["core_points"]),
                    "outcome": module["outcome"],
                }
                for module in course["modules"]
            ],
        }

    def _get_course(self, course_id: str) -> dict[str, Any]:
        course = COURSE_INDEX.get(course_id.strip())
        if course is None:
            raise ApiError("BAD_REQUEST", f"未知课程：{course_id}", 422)
        return course

    def _normalize_conversation(self, conversation: str) -> str:
        normalized = " ".join(conversation.strip().split())
        if len(normalized) < 10:
            raise ApiError("BAD_REQUEST", "请至少输入一段完整的学习描述，方便系统构建学习画像。", 422)
        return normalized

    def build_profile(
        self,
        course_id: str,
        conversation: str,
        preferred_goal: str = "",
        weekly_days: int | None = None,
        daily_minutes: int | None = None,
    ) -> dict[str, Any]:
        course = self._get_course(course_id)
        normalized_conversation = self._normalize_conversation(conversation)
        profile = self._build_profile_core(course, normalized_conversation, preferred_goal, weekly_days, daily_minutes)
        execution_plan = self.ai_settings_service.get_execution_plan()
        return {
            "course": self._serialize_course_summary(course),
            "profile": profile,
            "mode_requested": execution_plan["mode"],
            "mode_used": "local_rules",
            "provider_id": execution_plan["provider_id"],
            "runtime_message": execution_plan["runtime_message"],
            "fallback_reason": None,
            "generated_at": self._utc_now_iso(),
        }

    def generate_learning_package(
        self,
        course_id: str,
        conversation: str,
        preferred_goal: str = "",
        weekly_days: int | None = None,
        daily_minutes: int | None = None,
    ) -> dict[str, Any]:
        course = self._get_course(course_id)
        normalized_conversation = self._normalize_conversation(conversation)
        profile = self._build_profile_core(course, normalized_conversation, preferred_goal, weekly_days, daily_minutes)
        package = self._build_local_package(course, profile, normalized_conversation)
        execution_plan = self.ai_settings_service.get_execution_plan()
        runtime_provider = self.ai_settings_service.get_runtime_provider_config()
        mode_used = "local_rules"
        fallback_reason: str | None = None

        if not execution_plan["uses_local_rules"] and runtime_provider is not None:
            try:
                enhancement = self._generate_model_enhancement(course, profile, package, runtime_provider)
            except Exception as exc:
                fallback_reason = f"{self._format_model_error(exc)}，已自动回退到本地规则算法。"
            else:
                package = self._merge_model_enhancement(package, enhancement)
                mode_used = "model"
        elif not execution_plan["uses_local_rules"]:
            fallback_reason = "当前 AI 配置尚未就绪，已自动回退到本地规则算法。"

        return {
            "course": self._serialize_course_summary(course),
            "profile": profile,
            "package": package,
            "mode_requested": execution_plan["mode"],
            "mode_used": mode_used,
            "provider_id": execution_plan["provider_id"],
            "runtime_message": execution_plan["runtime_message"],
            "fallback_reason": fallback_reason,
            "generated_at": self._utc_now_iso(),
        }

    def _build_profile_core(
        self,
        course: dict[str, Any],
        conversation: str,
        preferred_goal: str,
        weekly_days: int | None,
        daily_minutes: int | None,
    ) -> dict[str, Any]:
        source = f"{preferred_goal} {conversation}".lower()
        schedule_days = weekly_days if weekly_days is not None else self._infer_weekly_days(source)
        schedule_minutes = daily_minutes if daily_minutes is not None else self._infer_daily_minutes(source)

        baseline_value, baseline_evidence = self._infer_baseline(source)
        goal_value, goal_evidence = self._infer_goal(source, preferred_goal, course["title"])
        style_value, style_evidence = self._infer_style(source)
        practice_value, practice_evidence = self._infer_practice(source)
        pace_value, pace_evidence = self._infer_pace(source, schedule_days, schedule_minutes)
        risk_value, risk_evidence = self._infer_risk(source)
        support_value, support_evidence = self._infer_support(risk_value, style_value)

        dimensions = [
            self._dimension("baseline", "基础水平", baseline_value, baseline_evidence, 0.78),
            self._dimension("goal", "目标导向", goal_value, goal_evidence, 0.81),
            self._dimension("schedule", "时间带宽", f"每周 {schedule_days} 天，每天约 {schedule_minutes} 分钟", "结合用户描述与默认节奏估计。", 0.7),
            self._dimension("style", "学习偏好", style_value, style_evidence, 0.75),
            self._dimension("practice", "练习方式", practice_value, practice_evidence, 0.74),
            self._dimension("pace", "节奏容忍度", pace_value, pace_evidence, 0.72),
            self._dimension("risk", "风险因子", risk_value, risk_evidence, 0.76),
            self._dimension("support", "支持策略", support_value, support_evidence, 0.79),
        ]
        focus_modules = self._pick_focus_modules(course, source, baseline_value)
        return {
            "overview": (
                f"当前画像显示：学习者以“{goal_value}”为主目标，基础水平为“{baseline_value}”，"
                f"适合采用“{style_value}”的学习方式，并优先围绕 {len(focus_modules)} 个核心模块建立主线。"
            ),
            "dimensions": dimensions,
            "strengths": self._build_strengths(goal_value, style_value, practice_value, schedule_days),
            "risks": self._build_risks(risk_value, schedule_days, schedule_minutes, baseline_value),
            "follow_up_questions": self._build_follow_up_questions(goal_value, style_value, focus_modules),
            "focus_modules": focus_modules,
            "weekly_days": schedule_days,
            "daily_minutes": schedule_minutes,
        }

    @staticmethod
    def _dimension(key: str, label: str, value: str, evidence: str, confidence: float) -> dict[str, Any]:
        return {
            "key": key,
            "label": label,
            "value": value,
            "evidence": evidence,
            "confidence": round(confidence, 2),
        }

    def _infer_weekly_days(self, source: str) -> int:
        if _contains_any(source, ["每天", "每日", "天天"]):
            return 6
        if _contains_any(source, ["周末", "双休"]):
            return 2
        if _contains_any(source, ["碎片", "零散", "抽空"]):
            return 3
        return 4

    def _infer_daily_minutes(self, source: str) -> int:
        minute_match = re.search(r"(\d{2,3})\s*分钟", source)
        if minute_match:
            return max(20, min(240, int(minute_match.group(1))))
        hour_match = re.search(r"(\d)\s*小时", source)
        if hour_match:
            return max(30, min(240, int(hour_match.group(1)) * 60))
        if _contains_any(source, ["冲刺", "高强度", "尽快"]):
            return 90
        if _contains_any(source, ["碎片", "通勤", "很晚"]):
            return 35
        return 50

    def _infer_baseline(self, source: str) -> tuple[str, str]:
        if _contains_any(source, ["零基础", "没学过", "完全不会", "刚开始"]):
            return "入门起步", "对话中明确提到基础较弱或刚开始接触。"
        if _contains_any(source, ["基础一般", "学过一点", "有些印象", "跟不上"]):
            return "基础待巩固", "用户表达为学过但不稳定，需要系统回补。"
        if _contains_any(source, ["做过项目", "刷过题", "能写出来", "学过一遍"]):
            return "具备基础", "已有一定实践或复习经历。"
        return "基础待确认", "当前描述未完整覆盖既往学习背景，先按中低基础处理。"

    def _infer_goal(self, source: str, preferred_goal: str, course_title: str) -> tuple[str, str]:
        combined = f"{preferred_goal} {source}"
        if _contains_any(combined, ["期末", "考试", "补考", "考核", "拿分"]):
            return "面向考试提分", "出现考试、补考或拿分等明确结果词。"
        if _contains_any(combined, ["面试", "找工作", "求职"]):
            return "面向面试应用", "对话中出现面试或求职诉求。"
        if _contains_any(combined, ["项目", "实战", "作品", "软件杯"]):
            return "面向项目落地", "更关注把课程知识变成可交付产出。"
        if _contains_any(combined, ["考研", "系统复习", "强化"]):
            return "面向长期强化", "更偏向阶段性系统复习。"
        return f"围绕《{course_title}》建立稳定主线", "当前目标描述较泛，先按课程主线学习处理。"

    def _infer_style(self, source: str) -> tuple[str, str]:
        if _contains_any(source, ["图", "脑图", "可视化", "动画"]):
            return "图解和可视化优先", "用户更容易通过图示理解知识结构。"
        if _contains_any(source, ["例题", "案例", "代码", "演示"]):
            return "案例驱动优先", "更适合通过例题和案例建立理解。"
        if _contains_any(source, ["讲义", "总结", "框架", "提纲"]):
            return "结构化讲义优先", "倾向先看清知识框架再深入细节。"
        return "讲解 + 例题混合", "未观察到强烈单一偏好，采用双通道呈现。"

    def _infer_practice(self, source: str) -> tuple[str, str]:
        if _contains_any(source, ["刷题", "题目", "练习", "自测"]):
            return "小步快练", "用户对题目反馈更敏感，适合多轮短练习。"
        if _contains_any(source, ["项目", "实验", "写代码", "动手"]):
            return "案例实操", "需要把练习尽量映射到真实任务。"
        return "讲练结合", "同时保留理解题和巩固题，避免只看不练。"

    def _infer_pace(self, source: str, weekly_days: int, daily_minutes: int) -> tuple[str, str]:
        if _contains_any(source, ["冲刺", "尽快", "马上", "时间很紧"]):
            return "短期冲刺", "用户表达了明显的时限压力。"
        if weekly_days >= 5 and daily_minutes >= 70:
            return "稳定推进", "可投入时间较连续，适合按阶段稳步推进。"
        if weekly_days <= 3 or daily_minutes <= 35:
            return "碎片化推进", "可用时间有限，需要压缩单次学习负荷。"
        return "中速推进", "当前时间带宽适合以周为单位迭代。"

    def _infer_risk(self, source: str) -> tuple[str, str]:
        if _contains_any(source, ["跟不上", "看不懂", "基础差", "总是忘"]):
            return "概念断层风险", "容易在核心概念处出现断层。"
        if _contains_any(source, ["没时间", "很忙", "碎片", "拖延"]):
            return "执行连续性风险", "学习节奏可能被外部事务打断。"
        if _contains_any(source, ["紧张", "焦虑", "怕挂科", "担心"]):
            return "情绪压力风险", "需要把计划颗粒度做小，降低挫败感。"
        return "风险整体可控", "当前描述中没有出现特别明显的高危信号。"

    def _infer_support(self, risk_value: str, style_value: str) -> tuple[str, str]:
        if "执行连续性风险" in risk_value:
            return "用短时任务和周回顾维持节奏", "需要借助更短任务闭环保证执行连续。"
        if "概念断层风险" in risk_value:
            return "先补先修知识，再进入综合题", "应优先修补前置概念，减少盲目刷题。"
        if "图解" in style_value:
            return "先框架后细节，配合脑图复盘", "更适合先搭知识骨架。"
        return "按阶段讲练结合，并保留复盘节点", "兼顾理解、训练和复盘的稳定策略。"

    def _build_strengths(self, goal_value: str, style_value: str, practice_value: str, schedule_days: int) -> list[str]:
        strengths = [
            f"目标较清晰：当前主目标是“{goal_value}”。",
            f"学习偏好明确：适合“{style_value}”的内容呈现。",
            f"练习习惯可设计：建议采用“{practice_value}”的训练节奏。",
        ]
        if schedule_days >= 4:
            strengths.append("每周至少能安排 4 天左右学习时间，具备形成稳定节奏的条件。")
        return strengths[:4]

    def _build_risks(self, risk_value: str, weekly_days: int, daily_minutes: int, baseline_value: str) -> list[str]:
        risks = [f"主要风险：{risk_value}。"]
        if weekly_days <= 3:
            risks.append("周学习天数偏少，建议把每次任务限制在一个明确知识点内。")
        if daily_minutes <= 35:
            risks.append("单次学习时长较短，内容不宜铺得过大。")
        if baseline_value in {"入门起步", "基础待巩固"}:
            risks.append("前置概念可能不稳定，综合题需要延后到讲解和例题之后。")
        return risks[:4]

    def _pick_focus_modules(self, course: dict[str, Any], source: str, baseline_value: str) -> list[dict[str, Any]]:
        scored: list[tuple[int, dict[str, Any]]] = []
        for index, module in enumerate(course["modules"]):
            score = max(0, 6 - index) if baseline_value in {"入门起步", "基础待巩固"} else index
            haystack = f"{module['title']} {' '.join(module['core_points'])}".lower()
            for token in re.split(r"[\s,，。；;、]+", source):
                if len(token) >= 2 and token in haystack:
                    score += 2
            scored.append((score, module))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            {
                "module_id": module["module_id"],
                "title": module["title"],
                "core_points": list(module["core_points"]),
                "outcome": module["outcome"],
            }
            for _, module in scored[:4]
        ]

    def _build_follow_up_questions(self, goal_value: str, style_value: str, focus_modules: list[dict[str, Any]]) -> list[str]:
        first_two = "、".join(module["title"] for module in focus_modules[:2]) or "核心模块"
        return [
            f"在“{goal_value}”之外，你更希望优先补基础还是优先做题？",
            f"如果按“{style_value}”展开内容，你更希望每次先看讲解还是先看例题？",
            f"当前最想先解决的模块是：{first_two}，还是课程中的其他部分？",
            "你最担心的是时间不够、概念看不懂，还是练习做不出来？",
        ]

    def _build_local_package(self, course: dict[str, Any], profile: dict[str, Any], conversation: str) -> dict[str, Any]:
        focus_modules = profile["focus_modules"]
        module_titles = [module["title"] for module in focus_modules]
        resources = self._build_resources(course, profile, focus_modules)
        learning_path = self._build_learning_path(profile, focus_modules)
        return {
            "package_overview": (
                f"本次资源包围绕《{course['title']}》的 {len(focus_modules)} 个核心模块展开，"
                f"优先覆盖 {module_titles[0]} 到 {module_titles[-1]} 的主线内容，"
                f"目标是在每周 {profile['weekly_days']} 天、每天 {profile['daily_minutes']} 分钟的节奏下形成闭环。"
            ),
            "coach_message": (
                f"先按“{profile['dimensions'][0]['value']} + {profile['dimensions'][3]['value']}”的组合推进。"
                "如果连续两次出现任务积压，就先缩小当天目标，不要直接扩大资源量。"
            ),
            "resource_count": len(resources),
            "resources": resources,
            "learning_path": learning_path,
            "agent_runs": self._build_agent_runs(profile, learning_path),
            "evaluation": self._build_evaluation_panel(course, focus_modules),
            "source_digest": {
                "conversation_excerpt": conversation[:180],
                "focus_module_titles": module_titles,
            },
        }

    def _build_resources(self, course: dict[str, Any], profile: dict[str, Any], focus_modules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        outline = "\n".join(f"- {module['title']}：{'、'.join(module['core_points'][:2])}" for module in focus_modules)
        first_module = focus_modules[0]
        second_module = focus_modules[1] if len(focus_modules) > 1 else focus_modules[0]
        last_module = focus_modules[-1]
        return [
            {
                "resource_id": "course-brief",
                "type": "course_brief",
                "title": f"{course['title']}主线讲解",
                "summary": "把课程目标、核心概念和难点拆成一页讲解提纲。",
                "estimated_minutes": 18,
                "agent_id": "explainer",
                "content_markdown": (
                    f"# {course['title']}主线讲解\n\n"
                    f"## 当前学习定位\n- 目标：{profile['dimensions'][1]['value']}\n"
                    f"- 基础：{profile['dimensions'][0]['value']}\n"
                    f"- 节奏：每周 {profile['weekly_days']} 天，每天 {profile['daily_minutes']} 分钟\n\n"
                    f"## 先抓住的主线\n{outline}\n\n"
                    f"## 第一优先模块：{first_module['title']}\n"
                    + "\n".join(f"- {point}" for point in first_module["core_points"])
                    + f"\n\n## 学完标志\n- {first_module['outcome']}"
                ),
            },
            {
                "resource_id": "mind-map",
                "type": "mind_map",
                "title": "课程脑图",
                "summary": "把核心模块串成一个可复盘的知识结构树。",
                "estimated_minutes": 10,
                "agent_id": "curator",
                "content_markdown": (
                    f"# {course['title']}脑图\n\n- 课程目标：{profile['dimensions'][1]['value']}\n"
                    + "\n".join(
                        f"  - {module['title']}\n" + "\n".join(f"    - {point}" for point in module["core_points"][:2])
                        for module in focus_modules
                    )
                ),
            },
            {
                "resource_id": "practice-pack",
                "type": "practice_pack",
                "title": "分层练习包",
                "summary": "包含热身题、标准题和迁移题，保证可练可检验。",
                "estimated_minutes": 25,
                "agent_id": "practice",
                "content_markdown": (
                    "# 分层练习包\n\n## 热身题\n"
                    f"1. 用自己的话解释“{first_module['title']}”为什么重要。\n"
                    f"2. 比较 {first_module['core_points'][0]} 与 {first_module['core_points'][1]} 的差别。\n\n"
                    "## 标准题\n"
                    f"1. 围绕 {second_module['title']} 写出一题课堂级别题目并给出步骤。\n"
                    "2. 用 5 分钟回忆本周三个关键词，再对照讲义补漏。\n\n"
                    "## 迁移题\n"
                    f"1. 说明 {last_module['title']} 在项目/考试中的使用场景。\n"
                    "2. 设计一道需要跨两个模块联动的综合题。"
                ),
            },
            {
                "resource_id": "reading-guide",
                "type": "reading_guide",
                "title": "精读与笔记指南",
                "summary": "告诉学习者该怎么看教材、怎么看例题、怎么记笔记。",
                "estimated_minutes": 12,
                "agent_id": "curator",
                "content_markdown": (
                    "# 精读与笔记指南\n\n## 阅读顺序\n"
                    + "\n".join(f"- 先读《{module['title']}》的定义、例题、结论。" for module in focus_modules[:3])
                    + "\n\n## 笔记模板\n- 定义\n- 关键步骤\n- 易错点\n- 自己的例子\n\n"
                    "## 复盘动作\n- 每学完一节，用 3 句话写出“它解决什么问题、怎么做、什么时候会错”。"
                ),
            },
            {
                "resource_id": "case-lab",
                "type": "case_lab",
                "title": "案例 / 实验任务",
                "summary": "把课程知识迁移到一个小案例，避免只停留在概念层。",
                "estimated_minutes": 35,
                "agent_id": "explainer",
                "content_markdown": (
                    "# 案例 / 实验任务\n\n"
                    f"## 任务主题\n将“{first_module['title']}”与“{last_module['title']}”串成一个小案例。\n\n"
                    "## 任务步骤\n1. 先写出目标和输入输出。\n2. 画出结构或流程。\n3. 完成实现/推导。\n4. 最后反思哪里最容易卡住。\n\n"
                    "## 提交物\n- 一页过程笔记\n- 一份答案/代码/推导结果\n- 一段 100 字复盘"
                ),
            },
            {
                "resource_id": "review-sheet",
                "type": "review_sheet",
                "title": "考前 / 复盘清单",
                "summary": "用于最后回顾重点、错因和下一次复现动作。",
                "estimated_minutes": 8,
                "agent_id": "coach",
                "content_markdown": (
                    "# 复盘清单\n\n## 我已经会了什么\n"
                    + "\n".join(f"- {module['title']}：是否能独立说出关键步骤？" for module in focus_modules[:3])
                    + "\n\n## 我还不会什么\n- 哪个定义总是记混？\n- 哪个题型一上手就卡住？\n\n"
                    "## 下一次学习前要做什么\n- 重看一段讲解\n- 补做一道标准题\n- 把错因写成一句提醒"
                ),
            },
        ]

    def _build_learning_path(self, profile: dict[str, Any], focus_modules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        weekly_days = int(profile["weekly_days"])
        daily_minutes = int(profile["daily_minutes"])
        return [
            {
                "stage_id": "stage-1",
                "title": "阶段一：建立主线",
                "objective": "先打通核心定义、基本流程和课程骨架。",
                "focus_modules": [focus_modules[0]["title"], focus_modules[1]["title"] if len(focus_modules) > 1 else focus_modules[0]["title"]],
                "deliverables": ["一页知识框架图", "2 道热身题", "一份术语清单"],
                "study_plan": f"建议连续 1 周，每周 {weekly_days} 天，每天 {daily_minutes} 分钟。",
                "coach_tip": "先保证学完能复述，不急着一开始就做综合题。",
            },
            {
                "stage_id": "stage-2",
                "title": "阶段二：讲练闭环",
                "objective": "把重点模块转化为标准题、错题和迁移题。",
                "focus_modules": [module["title"] for module in focus_modules[1:3] or focus_modules[:2]],
                "deliverables": ["1 份标准题答案", "1 份错因归纳", "1 个案例草稿"],
                "study_plan": f"建议再用 1 到 2 周，以每次 {daily_minutes} 分钟完成讲练一体。",
                "coach_tip": "每次练习后都要记录一个“为什么错”，这样复盘才会累积。",
            },
            {
                "stage_id": "stage-3",
                "title": "阶段三：综合输出",
                "objective": "把分散知识合并成考试/项目可迁移的完成能力。",
                "focus_modules": [last_module["title"] for last_module in [focus_modules[-1], focus_modules[0]]],
                "deliverables": ["一份综合题/案例答案", "一页复盘清单", "个人提分策略"],
                "study_plan": "最后留出一个完整复盘窗口，串联重点、错题和常见陷阱。",
                "coach_tip": "如果时间紧，就优先保留综合输出和错因复盘，不再盲目加新内容。",
            },
        ]

    def _build_agent_runs(self, profile: dict[str, Any], learning_path: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"agent_id": "profiler", "name": "学习画像智能体", "status": "completed", "summary": f"已生成 {len(profile['dimensions'])} 维学习画像，并识别 {len(profile['risks'])} 条风险。"},
            {"agent_id": "planner", "name": "路径规划智能体", "status": "completed", "summary": f"已输出 {len(learning_path)} 阶段学习路径。"},
            {"agent_id": "explainer", "name": "课程讲解智能体", "status": "completed", "summary": "已生成主线讲解和案例任务。"},
            {"agent_id": "practice", "name": "练习设计智能体", "status": "completed", "summary": "已生成热身、标准和迁移三层练习。"},
            {"agent_id": "curator", "name": "资源策展智能体", "status": "completed", "summary": "已组合脑图和精读指南，保证复习路径完整。"},
            {"agent_id": "coach", "name": "督学教练智能体", "status": "completed", "summary": "已生成节奏提醒与复盘清单。"},
        ]

    def _build_evaluation_panel(self, course: dict[str, Any], focus_modules: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "mastery_signals": [
                f"能在不看资料的情况下复述 {focus_modules[0]['title']} 的关键步骤。",
                f"能独立完成一题与 {focus_modules[1]['title'] if len(focus_modules) > 1 else focus_modules[0]['title']} 相关的标准题。",
                f"能把《{course['title']}》中两个模块连起来解释一个综合场景。",
            ],
            "self_check_questions": [
                f"如果让你教别人 {focus_modules[0]['title']}，你会先讲哪三个点？",
                "你当前最容易错的是概念、步骤还是审题？",
                "今天这次学习结束后，哪一条内容明天还能完整写出来？",
            ],
            "rubric": [
                {"level": "起步", "description": "能识别概念，但解释和迁移还不稳定。"},
                {"level": "稳固", "description": "能完成标准题，并说清核心步骤。"},
                {"level": "迁移", "description": "能把多个模块合起来解决综合问题。"},
            ],
        }

    def _generate_model_enhancement(
        self,
        course: dict[str, Any],
        profile: dict[str, Any],
        package: dict[str, Any],
        runtime_provider: dict[str, Any],
    ) -> dict[str, Any]:
        prompt = self._build_model_prompt(course, profile, package)
        raw = self._call_model(prompt, runtime_provider)
        parsed = _extract_json_object(raw)
        resources: list[dict[str, Any]] = []
        if isinstance(parsed.get("resources"), list):
            for item in parsed["resources"]:
                if not isinstance(item, dict):
                    continue
                resource_id = str(item.get("resource_id") or "").strip()
                if not resource_id:
                    continue
                resources.append(
                    {
                        "resource_id": resource_id,
                        "summary": self._clean_text(item.get("summary"), 160),
                        "content_markdown": self._clean_multiline_text(item.get("content_markdown"), 1800),
                    }
                )
        path_tips: list[dict[str, str]] = []
        if isinstance(parsed.get("path_tips"), list):
            for item in parsed["path_tips"]:
                if not isinstance(item, dict):
                    continue
                stage_id = str(item.get("stage_id") or "").strip()
                coach_tip = self._clean_text(item.get("coach_tip"), 140)
                if stage_id and coach_tip:
                    path_tips.append({"stage_id": stage_id, "coach_tip": coach_tip})
        return {
            "package_overview": self._clean_text(parsed.get("package_overview"), 240),
            "coach_message": self._clean_text(parsed.get("coach_message"), 220),
            "resources": resources,
            "path_tips": path_tips,
        }

    def _merge_model_enhancement(self, package: dict[str, Any], enhancement: dict[str, Any]) -> dict[str, Any]:
        merged = copy.deepcopy(package)
        if enhancement.get("package_overview"):
            merged["package_overview"] = enhancement["package_overview"]
        if enhancement.get("coach_message"):
            merged["coach_message"] = enhancement["coach_message"]
        resource_map = {item["resource_id"]: item for item in merged["resources"]}
        for item in enhancement.get("resources", []):
            target = resource_map.get(item["resource_id"])
            if target is None:
                continue
            if item.get("summary"):
                target["summary"] = item["summary"]
            if item.get("content_markdown"):
                target["content_markdown"] = item["content_markdown"]
        stage_map = {item["stage_id"]: item for item in merged["learning_path"]}
        for tip in enhancement.get("path_tips", []):
            target = stage_map.get(tip["stage_id"])
            if target is not None:
                target["coach_tip"] = tip["coach_tip"]
        return merged

    def _build_model_prompt(self, course: dict[str, Any], profile: dict[str, Any], package: dict[str, Any]) -> str:
        payload = {
            "course": self._serialize_course_summary(course),
            "profile_overview": profile["overview"],
            "dimensions": profile["dimensions"],
            "focus_modules": profile["focus_modules"],
            "package": {
                "package_overview": package["package_overview"],
                "coach_message": package["coach_message"],
                "resources": [{"resource_id": item["resource_id"], "title": item["title"], "summary": item["summary"]} for item in package["resources"]],
                "learning_path": [{"stage_id": item["stage_id"], "title": item["title"], "coach_tip": item["coach_tip"]} for item in package["learning_path"]],
            },
        }
        return (
            "你是学习资源总编排智能体。请基于课程、学习画像和本地生成的资源草案，"
            "输出更自然、更可执行的中文 JSON。不要添加额外字段，也不要输出解释。\n"
            "JSON 结构：\n"
            "{\n"
            '  "package_overview": "120字以内的总述",\n'
            '  "coach_message": "100字以内的督学建议",\n'
            '  "resources": [{"resource_id": "course-brief", "summary": "一句摘要", "content_markdown": "Markdown正文"}],\n'
            '  "path_tips": [{"stage_id": "stage-1", "coach_tip": "一句阶段提醒"}]\n'
            "}\n"
            "要求：\n1. 不新增资源，只优化已有资源。\n2. 语气务实、具体，避免空泛鼓励。\n3. 不要建议自动修改数据库。\n"
            f"输入数据：{json.dumps(payload, ensure_ascii=False)}"
        )

    def _call_model(self, prompt: str, runtime_provider: dict[str, Any]) -> str:
        timeout = float(runtime_provider.get("timeout_seconds") or 30)
        transport = runtime_provider.get("transport")
        base_url = str(runtime_provider.get("base_url") or "").rstrip("/")
        model_name = str(runtime_provider.get("model_name") or "")
        temperature = float(runtime_provider.get("temperature") or 0.2)
        max_tokens = int(runtime_provider.get("max_tokens") or 1200)
        api_key = str(runtime_provider.get("api_key") or "")
        with httpx.Client(timeout=timeout) as client:
            if transport == "ollama":
                response = client.post(
                    f"{base_url}/api/chat",
                    json={
                        "model": model_name,
                        "stream": False,
                        "format": "json",
                        "messages": [
                            {"role": "system", "content": "你是严谨的学习资源策划助手，只输出 JSON。"},
                            {"role": "user", "content": prompt},
                        ],
                        "options": {"temperature": temperature, "num_predict": max_tokens},
                    },
                )
                response.raise_for_status()
                payload = response.json()
                content = (payload.get("message") or {}).get("content")
                if isinstance(content, str) and content.strip():
                    return content
                raise ValueError("ollama response missing content")
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            response = client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model_name,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": "你是严谨的学习资源策划助手，只输出 JSON。"},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            response.raise_for_status()
            payload = response.json()
            choices = payload.get("choices") or []
            if not choices:
                raise ValueError("model response missing choices")
            message = choices[0].get("message") or {}
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content
            raise ValueError("model response missing content")

    @staticmethod
    def _clean_text(value: Any, max_length: int) -> str:
        if not isinstance(value, str):
            return ""
        collapsed = " ".join(value.replace("\r", " ").replace("\n", " ").split())
        return collapsed[:max_length].strip()

    @staticmethod
    def _clean_multiline_text(value: Any, max_length: int) -> str:
        if not isinstance(value, str):
            return ""
        normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
        return normalized[:max_length].rstrip()

    @staticmethod
    def _format_model_error(exc: Exception) -> str:
        if isinstance(exc, httpx.TimeoutException):
            return "AI 请求超时"
        if isinstance(exc, httpx.HTTPStatusError):
            status_code = exc.response.status_code
            if status_code in {401, 403}:
                return "AI 认证失败，请检查 API Key 或服务权限"
            if status_code == 404:
                return "AI 接口地址不存在，请检查 API Base URL"
            if status_code >= 500:
                return "AI 服务暂时不可用"
            return f"AI 服务返回状态码 {status_code}"
        if isinstance(exc, httpx.RequestError):
            return "无法连接到 AI 服务"
        return str(exc).strip() or "AI 调用失败"

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
