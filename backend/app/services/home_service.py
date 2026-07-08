from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from app.errors import ApiError
from app.repositories.home_repository import HomeRepository
from app.repositories.task_repository import TaskRepository
from app.repositories.time_ledger_repository import TimeLedgerRepository

DEFAULT_UX_CONFIG = {"input_type": "number", "quick_step": 1, "detail_enabled": True}
ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]


def _parse_date_or_raise(raw: str) -> date:
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ApiError("BAD_REQUEST", f"日期格式错误: {raw}，应为 YYYY-MM-DD", 400) from exc


def _parse_date_optional(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def _normalize_date_string(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    if not value:
        return None
    parsed = _parse_date_optional(value)
    if parsed is None:
        return None
    return parsed.isoformat()


def _normalize_task_ids(raw: str | None) -> list[int]:
    if raw is None:
        return []
    value = raw.strip()
    if value == "":
        return []
    ids: list[int] = []
    for chunk in value.split(","):
        token = chunk.strip()
        if token == "":
            continue
        if not token.isdigit():
            raise ApiError("BAD_REQUEST", f"task_ids 包含非法值: {token}", 400)
        task_id = int(token)
        if task_id <= 1:
            continue
        ids.append(task_id)
    return sorted(set(ids))


def _normalize_weekdays(raw: Any) -> list[int]:
    if not isinstance(raw, list):
        return []
    unique: set[int] = set()
    for item in raw:
        try:
            day = int(item)
        except (TypeError, ValueError):
            continue
        if 1 <= day <= 7:
            unique.add(day)
    return sorted(unique)


def _format_weekday_group_key(weekdays: list[int]) -> str:
    return ",".join(str(day) for day in sorted(set(weekdays)))


def _normalize_shared_groups(raw: Any, active_weekdays: list[int]) -> list[list[int]]:
    if not isinstance(raw, list):
        return []
    active = set(active_weekdays)
    group_map: dict[str, list[int]] = {}
    for group in raw:
        normalized = [day for day in _normalize_weekdays(group) if day in active]
        if len(normalized) < 2:
            continue
        key = _format_weekday_group_key(normalized)
        group_map[key] = normalized
    return list(group_map.values())


def _normalize_overrides(raw: Any) -> dict[str, float]:
    if not isinstance(raw, dict):
        return {}
    result: dict[str, float] = {}
    for key, value in raw.items():
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if numeric > 0:
            result[str(key)] = numeric
    return result


def _resolve_input_type(raw_ux: dict[str, Any]) -> str:
    input_type = raw_ux.get("input_type")
    if input_type in {"boolean", "number", "timer"}:
        return str(input_type)
    legacy_mode = raw_ux.get("input_mode")
    if legacy_mode == "toggle":
        return "boolean"
    if legacy_mode == "number":
        return "number"
    return "number"


def _parse_calc_payload(calc_config: str | None) -> tuple[dict, dict, dict, str | None]:
    if not calc_config:
        return {}, {}, dict(DEFAULT_UX_CONFIG), None

    try:
        payload = json.loads(calc_config)
    except json.JSONDecodeError as exc:
        return {}, {}, dict(DEFAULT_UX_CONFIG), f"calc_config 解析失败: {exc.msg}"

    if not isinstance(payload, dict):
        return {}, {}, dict(DEFAULT_UX_CONFIG), "calc_config 结构非法，需为 JSON 对象"

    schedule = payload.get("schedule_config")
    if isinstance(schedule, dict):
        schedule_config = dict(schedule)
    else:
        schedule_config = dict(payload)

    raw_ux = schedule_config.get("ux_config")
    if not isinstance(raw_ux, dict):
        raw_ux = payload.get("ux_config")
    if not isinstance(raw_ux, dict):
        raw_ux = {}

    input_type = _resolve_input_type(raw_ux)

    quick_step_raw = raw_ux.get("quick_step")
    try:
        quick_step = float(quick_step_raw)
    except (TypeError, ValueError):
        quick_step = 1
    if quick_step <= 0:
        quick_step = 1

    detail_enabled = raw_ux.get("detail_enabled")
    detail = detail_enabled if isinstance(detail_enabled, bool) else True

    ux_config = {
        "input_type": input_type,
        "quick_step": quick_step,
        "detail_enabled": detail,
    }
    return payload, schedule_config, ux_config, None


def _parse_calc_config(calc_config: str | None) -> tuple[dict, dict, str | None]:
    _, schedule, ux, err = _parse_calc_payload(calc_config)
    return schedule, ux, err


def _normalize_schedule_config(schedule_config: dict) -> dict:
    raw_type = schedule_config.get("type")
    if raw_type in {"specific_days", "shared_days"}:
        schedule_type = raw_type
    else:
        schedule_type = "daily"

    requested_weekdays = _normalize_weekdays(schedule_config.get("active_weekdays"))
    active_weekdays = list(ALL_WEEKDAYS) if schedule_type == "daily" else (requested_weekdays or list(ALL_WEEKDAYS))

    shared_groups = (
        _normalize_shared_groups(schedule_config.get("shared_weekday_groups"), active_weekdays)
        if schedule_type == "shared_days"
        else []
    )

    return {
        "type": schedule_type,
        "active_weekdays": active_weekdays,
        "shared_weekday_groups": shared_groups,
        "period_start": _normalize_date_string(schedule_config.get("period_start")),
        "period_end": _normalize_date_string(schedule_config.get("period_end")),
        "target_overrides": _normalize_overrides(schedule_config.get("target_overrides")),
    }


def _iter_dates(start: date, end: date):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += timedelta(days=1)


def _resolve_day_target(base_target: float | None, overrides: dict[str, float], weekday: int) -> float | None:
    day_key = str(weekday)
    if day_key in overrides:
        return overrides[day_key]
    if "daily" in overrides:
        return overrides["daily"]
    return base_target


def _resolve_group_target(
    base_target: float | None,
    overrides: dict[str, float],
    group_weekdays: list[int],
) -> float | None:
    group_key = _format_weekday_group_key(group_weekdays)
    if group_key in overrides:
        return overrides[group_key]
    for weekday in sorted(set(group_weekdays)):
        day_key = str(weekday)
        if day_key in overrides:
            return overrides[day_key]
    if "daily" in overrides:
        return overrides["daily"]
    return base_target


def _round_metric(value: float) -> float:
    return float(round(value, 4))


def _build_recommendation(completion_rate: float | None, total_target: float | None) -> tuple[str, str]:
    if completion_rate is None or total_target is None:
        return "renew", "当前属性未设置周期目标，建议先续期保持节奏"
    if completion_rate < 60:
        return "archive", "完成率偏低，先归档沉淀本周期会更稳"
    if completion_rate <= 90:
        return "renew", "完成率稳定，续期可以延续当前状态"
    return "evolve", "完成率极高，建议进阶到更高挑战规则"


def _build_review_copy(
    completion_rate: float | None,
    total_actual: float,
    total_target: float | None,
    recommended_action: str,
) -> str:
    if completion_rate is None or total_target is None:
        return f"当前周期累计完成 {_round_metric(total_actual)}，尚未设置明确目标，建议先续期保持节奏"
    if recommended_action == "archive":
        return f"本周期综合达成率 {_round_metric(completion_rate)}%，建议先归档复盘，再开启下一段旅程"
    if recommended_action == "renew":
        return f"本周期综合达成率 {_round_metric(completion_rate)}%，节奏稳定，续期会是更稳健的选择"
    return f"本周期综合达成率 {_round_metric(completion_rate)}%，状态火热，适合进阶挑战更高规则"


def _aggregate_settlement_totals(
    schedule: dict,
    records_by_date: dict[str, float],
    base_target: float | None,
    period_start: date,
    period_end: date,
) -> tuple[float, float | None]:
    schedule_type = schedule["type"]
    active_weekdays = set(schedule["active_weekdays"])
    overrides = schedule["target_overrides"]

    shared_lookup: dict[int, list[int]] = {}
    if schedule_type == "shared_days":
        for group in schedule["shared_weekday_groups"]:
            for weekday in group:
                shared_lookup.setdefault(weekday, group)

    total_actual = 0.0
    total_target = 0.0
    has_any_target = False

    shared_buckets: dict[tuple[str, str], dict[str, float | None]] = {}

    for current in _iter_dates(period_start, period_end):
        weekday = current.isoweekday()
        if schedule_type != "daily" and weekday not in active_weekdays:
            continue

        day_key = current.isoformat()
        actual = float(records_by_date.get(day_key, 0.0))

        shared_group = shared_lookup.get(weekday)
        if shared_group and len(shared_group) >= 2:
            monday = (current - timedelta(days=weekday - 1)).isoformat()
            group_key = _format_weekday_group_key(shared_group)
            bucket_key = (group_key, monday)
            if bucket_key not in shared_buckets:
                target = _resolve_group_target(base_target, overrides, shared_group)
                shared_buckets[bucket_key] = {"actual": 0.0, "target": target}
            shared_buckets[bucket_key]["actual"] = float(shared_buckets[bucket_key]["actual"] or 0.0) + actual
            continue

        total_actual += actual
        target = _resolve_day_target(base_target, overrides, weekday)
        if target is not None and target > 0:
            total_target += target
            has_any_target = True

    for bucket in shared_buckets.values():
        total_actual += float(bucket["actual"] or 0.0)
        target = bucket["target"]
        if target is not None and target > 0:
            total_target += target
            has_any_target = True

    return _round_metric(total_actual), (_round_metric(total_target) if has_any_target else None)


class HomeService:
    def __init__(
        self,
        repo: HomeRepository,
        task_repo: TaskRepository,
        time_repo: TimeLedgerRepository | None = None,
    ) -> None:
        self.repo = repo
        self.task_repo = task_repo
        self.time_repo = time_repo or TimeLedgerRepository(repo.db)

    def command_center(self, record_date: str, task_ids_raw: str | None) -> dict:
        target_day = _parse_date_or_raise(record_date)
        selected_task_ids = _normalize_task_ids(task_ids_raw)

        if selected_task_ids:
            invalid_ids = [task_id for task_id in selected_task_ids if not self.task_repo.task_exists(task_id)]
            if invalid_ids:
                raise ApiError("NOT_FOUND", f"任务不存在: {', '.join(str(x) for x in invalid_ids)}", 404)

        tasks = self.repo.list_tasks(None)
        available_task_ids = [int(item["task_id"]) for item in tasks]
        effective_task_ids = selected_task_ids if selected_task_ids else available_task_ids

        if not available_task_ids:
            return {
                "date": record_date,
                "tasks": [],
                "filters": {"selected_task_ids": [], "available_task_ids": []},
                "inbox_events": [],
                "pending_review_cards": [],
                "record_cards": [],
                "todo_summary": {"total": 0, "completed": 0, "todayCompleted": 0},
                "focus_summary": {"todaySeconds": 0, "totalSeconds": 0},
            }

        selected_cards_raw = self.repo.list_record_cards(effective_task_ids)
        global_cards_raw = self.repo.list_record_cards(available_task_ids)
        today_records = self.repo.list_records_on_date(available_task_ids, record_date)
        last_times = self.repo.list_last_record_times(available_task_ids)

        today_map = {(int(item["task_id"]), int(item["attr_id"])): item for item in today_records}
        last_map = {(int(item["task_id"]), int(item["attr_id"])): item.get("last_record_time") for item in last_times}

        inbox_events: list[dict] = []
        pending_review_cards: list[dict] = []
        card_cache: dict[tuple[int, int], dict] = {}

        for card in global_cards_raw:
            task_id = int(card["task_id"])
            attr_id = int(card["attr_id"])
            key = (task_id, attr_id)
            if key in card_cache:
                continue

            _, schedule_config, ux_config, parse_error = _parse_calc_payload(card.get("calc_config"))
            normalized_schedule = _normalize_schedule_config(schedule_config)

            raw_period_start = schedule_config.get("period_start") if isinstance(schedule_config.get("period_start"), str) else None
            raw_period_end = schedule_config.get("period_end") if isinstance(schedule_config.get("period_end"), str) else None
            period_start = _normalize_date_string(raw_period_start)
            period_end = _normalize_date_string(raw_period_end)
            if raw_period_end and period_end is None and parse_error is None:
                parse_error = "period_end 日期格式非法，需为 YYYY-MM-DD"

            end_day = _parse_date_optional(period_end)
            is_pending_settlement = end_day is not None and target_day > end_day

            today_data = today_map.get(key)
            card_payload = {
                "card_id": f"{task_id}:{attr_id}",
                "task_id": task_id,
                "task_name": card["task_name"],
                "task_color": card["task_color"],
                "attr_id": attr_id,
                "attr_name": card["attr_name"],
                "attr_unit": card["attr_unit"] or "",
                "target_value": card["target_value"],
                "weight": card["weight"],
                "calc_type": card["calc_type"],
                "calc_config": card["calc_config"] or "{}",
                "ux_config": ux_config,
                "period_start": period_start,
                "period_end": period_end,
                "is_pending_settlement": is_pending_settlement,
                "today_value": today_data["data_value"] if today_data else None,
                "today_record_time": today_data["create_time"] if today_data else None,
                "last_record_time": last_map.get(key),
                "_pending_sort_date": end_day,
            }
            card_cache[key] = card_payload

            if is_pending_settlement and end_day is not None:
                ended_days_ago = max(1, (target_day - end_day).days)
                pending_review_cards.append(
                    {
                        "card_id": card_payload["card_id"],
                        "task_id": task_id,
                        "task_name": card["task_name"],
                        "task_color": card["task_color"],
                        "attr_id": attr_id,
                        "attr_name": card["attr_name"],
                        "attr_unit": card["attr_unit"] or "",
                        "period_start": period_start,
                        "period_end": period_end,
                        "ended_days_ago": ended_days_ago,
                        "title": f"{card['attr_name']} 周期已结束",
                        "cta_label": "🎁 周期目标已达成，点击结算进化",
                    }
                )
                inbox_events.append(
                    {
                        "event_id": f"pending_settlement:{task_id}:{attr_id}",
                        "type": "pending_settlement",
                        "severity": "warning",
                        "task_id": task_id,
                        "task_name": card["task_name"],
                        "attr_id": attr_id,
                        "attr_name": card["attr_name"],
                        "period_start": period_start,
                        "period_end": period_end,
                        "title": f"{card['task_name']} / {card['attr_name']} 周期已结束，待结算",
                        "message": "请前往结算弹窗执行续期、进阶或归档",
                    }
                )

            if parse_error:
                inbox_events.append(
                    {
                        "event_id": f"critical_error:{task_id}:{attr_id}",
                        "type": "critical_error",
                        "severity": "error",
                        "task_id": task_id,
                        "task_name": card["task_name"],
                        "attr_id": attr_id,
                        "attr_name": card["attr_name"],
                        "title": f"{card['task_name']} / {card['attr_name']} 配置异常",
                        "message": parse_error,
                    }
                )

        result_cards: list[dict] = []
        for card in selected_cards_raw:
            key = (int(card["task_id"]), int(card["attr_id"]))
            item = card_cache.get(key)
            if not item:
                continue
            if item["is_pending_settlement"]:
                continue
            clean_item = dict(item)
            clean_item.pop("_pending_sort_date", None)
            result_cards.append(clean_item)

        pending_review_cards.sort(
            key=lambda item: (
                _parse_date_optional(item.get("period_end")) or date.max,
                int(item["task_id"]),
                int(item["attr_id"]),
            )
        )
        inbox_events.sort(key=lambda item: (item["severity"] != "error", item["event_id"]))
        result_cards.sort(key=lambda item: (item["task_id"], item["attr_id"]))

        todo_summary = self.repo.todo_summary(effective_task_ids if selected_task_ids else None, record_date)
        focus_summary = self.repo.focus_summary(effective_task_ids if selected_task_ids else None, record_date)

        return {
            "date": record_date,
            "tasks": tasks,
            "filters": {
                "selected_task_ids": effective_task_ids,
                "available_task_ids": available_task_ids,
            },
            "inbox_events": inbox_events,
            "pending_review_cards": pending_review_cards,
            "record_cards": result_cards,
            "todo_summary": todo_summary,
            "focus_summary": focus_summary,
        }

    def get_settlement_report(self, task_id: int, attr_id: int, record_date: str) -> dict:
        target_day = _parse_date_or_raise(record_date)
        card = self.repo.get_attr_card(task_id, attr_id)
        if not card:
            raise ApiError("NOT_FOUND", f"属性 {attr_id} 不属于任务 {task_id}", 404)
        if int(card["attr_record"]) != 1:
            raise ApiError("BAD_REQUEST", "该属性不支持结算", 400)

        _, schedule_config, _, _ = _parse_calc_payload(card.get("calc_config"))
        schedule = _normalize_schedule_config(schedule_config)

        period_end_str = schedule["period_end"]
        period_end_day = _parse_date_optional(period_end_str)
        if period_end_day is None:
            period_end_day = target_day
            period_end_str = period_end_day.isoformat()

        period_start_source = "config"
        period_start_str = schedule["period_start"]
        period_start_day = _parse_date_optional(period_start_str)
        if period_start_day is None:
            earliest_record = self.repo.get_earliest_attr_record_date(task_id, attr_id)
            earliest_day = _parse_date_optional(earliest_record)
            if earliest_day is not None:
                period_start_day = earliest_day
                period_start_str = earliest_day.isoformat()
                period_start_source = "earliest_record"
            else:
                period_start_day = period_end_day
                period_start_str = period_end_day.isoformat()

        if period_start_day > period_end_day:
            period_start_day = period_end_day
            period_start_str = period_end_day.isoformat()

        records = self.repo.list_attr_records_in_range(task_id, attr_id, period_start_str, period_end_str)
        records_by_date: dict[str, float] = {}
        for row in records:
            date_key = str(row["record_date"])
            records_by_date[date_key] = records_by_date.get(date_key, 0.0) + float(row["data_value"])

        base_target = float(card["target_value"]) if float(card["target_value"]) > 0 else None
        total_actual, total_target = _aggregate_settlement_totals(
            schedule=schedule,
            records_by_date=records_by_date,
            base_target=base_target,
            period_start=period_start_day,
            period_end=period_end_day,
        )

        completion_rate: float | None = None
        over_target_value: float | None = None
        if total_target is not None and total_target > 0:
            completion_rate = _round_metric((total_actual / total_target) * 100)
            over_target_value = _round_metric(max(total_actual - total_target, 0.0))

        recommended_action, recommendation_reason = _build_recommendation(completion_rate, total_target)
        review_copy = _build_review_copy(completion_rate, total_actual, total_target, recommended_action)

        return {
            "task_id": task_id,
            "task_name": card["task_name"],
            "attr_id": attr_id,
            "attr_name": card["attr_name"],
            "period_start": period_start_str,
            "period_end": period_end_str,
            "period_start_source": period_start_source,
            "total_actual": total_actual,
            "total_target": total_target,
            "completion_rate": completion_rate,
            "over_target_value": over_target_value,
            "review_copy": review_copy,
            "recommended_action": recommended_action,
            "recommendation_reason": recommendation_reason,
        }

    def apply_settlement_action(self, payload: dict) -> dict:
        task_id = int(payload.get("task_id") or 0)
        attr_id = int(payload.get("attr_id") or 0)
        action = str(payload.get("action") or "").strip().lower()
        anchor_raw = payload.get("anchor_date")

        if task_id <= 1:
            raise ApiError("BAD_REQUEST", f"task_id 无效: {task_id}", 400)
        if attr_id <= 0:
            raise ApiError("BAD_REQUEST", f"attr_id 无效: {attr_id}", 400)
        if action not in {"renew", "archive"}:
            raise ApiError("BAD_REQUEST", "action 仅支持 renew / archive", 400)

        anchor_day = _parse_date_or_raise(anchor_raw) if isinstance(anchor_raw, str) and anchor_raw.strip() else date.today()

        card = self.repo.get_attr_card(task_id, attr_id)
        if not card:
            raise ApiError("NOT_FOUND", f"属性 {attr_id} 不属于任务 {task_id}", 404)
        if int(card["attr_record"]) != 1:
            raise ApiError("BAD_REQUEST", "该属性不支持结算动作", 400)

        if action == "archive":
            updated = self.repo.update_attr_relation(task_id, attr_id, attr_sign=2)
            if not updated:
                raise ApiError("NOT_FOUND", "任务属性不存在", 404)
            return {
                "task_id": task_id,
                "attr_id": attr_id,
                "action": "archive",
                "attr_sign": 2,
            }

        raw_payload, schedule_config, ux_config, _ = _parse_calc_payload(card.get("calc_config"))
        schedule = _normalize_schedule_config(schedule_config)

        old_period_end = _parse_date_optional(schedule["period_end"]) or anchor_day
        old_period_start = _parse_date_optional(schedule["period_start"])
        if old_period_start is None:
            earliest = self.repo.get_earliest_attr_record_date(task_id, attr_id)
            old_period_start = _parse_date_optional(earliest)
        if old_period_start is None:
            old_period_start = old_period_end
        if old_period_start > old_period_end:
            old_period_start = old_period_end

        cycle_days = max(1, (old_period_end - old_period_start).days + 1)
        new_start = anchor_day
        new_end = anchor_day + timedelta(days=cycle_days - 1)

        updated_schedule = dict(schedule)
        updated_schedule["period_start"] = new_start.isoformat()
        updated_schedule["period_end"] = new_end.isoformat()
        updated_schedule["ux_config"] = ux_config

        calc_payload = dict(raw_payload) if isinstance(raw_payload, dict) else {}
        calc_payload["schedule_config"] = updated_schedule
        calc_config = json.dumps(calc_payload, ensure_ascii=False)

        updated = self.repo.update_attr_relation(task_id, attr_id, attr_sign=0, calc_config=calc_config)
        if not updated:
            raise ApiError("NOT_FOUND", "任务属性不存在", 404)

        return {
            "task_id": task_id,
            "attr_id": attr_id,
            "action": "renew",
            "period_start": new_start.isoformat(),
            "period_end": new_end.isoformat(),
            "cycle_days": cycle_days,
            "attr_sign": 0,
        }

    def focus_capture(self, payload: dict) -> dict:
        task_id = int(payload.get("task_id") or 0)
        timer_attr_id_raw = payload.get("timer_attr_id")
        start_time_raw = payload.get("start_time")
        duration_raw = payload.get("duration_seconds")
        record_date_raw = payload.get("record_date")

        if task_id <= 1:
            raise ApiError("BAD_REQUEST", f"task_id 无效: {task_id}", 400)
        if not self.task_repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", f"任务不存在: {task_id}", 404)

        if not isinstance(start_time_raw, str) or start_time_raw.strip() == "":
            raise ApiError("BAD_REQUEST", "start_time 不能为空", 400)
        try:
            parsed_start_time = datetime.fromisoformat(start_time_raw.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ApiError("BAD_REQUEST", "start_time 格式非法，应为 ISO 时间", 400) from exc

        try:
            duration_seconds = int(duration_raw)
        except (TypeError, ValueError) as exc:
            raise ApiError("BAD_REQUEST", f"duration_seconds 非法: {duration_raw}", 400) from exc
        if duration_seconds <= 0:
            raise ApiError("BAD_REQUEST", "duration_seconds 必须大于 0", 400)

        if not isinstance(record_date_raw, str) or record_date_raw.strip() == "":
            raise ApiError("BAD_REQUEST", "record_date 不能为空", 400)
        record_day = _parse_date_or_raise(record_date_raw.strip())

        attrs = self.repo.list_task_attrs(task_id)
        if not attrs:
            raise ApiError("BAD_REQUEST", "任务缺少属性配置，无法记录专注", 400)

        focus_attr = next((item for item in attrs if int(item["attr_id"]) == 4), None)
        if not focus_attr:
            focus_attr = next((item for item in attrs if str(item.get("attr_name") or "").strip() == "专注时长"), None)
        if not focus_attr:
            raise ApiError("BAD_REQUEST", "任务缺少“专注时长”属性，无法记录专注", 400)
        focus_attr_id = int(focus_attr["attr_id"])

        timer_attr_id: int | None = None
        if timer_attr_id_raw is not None:
            try:
                timer_attr_id = int(timer_attr_id_raw)
            except (TypeError, ValueError) as exc:
                raise ApiError("BAD_REQUEST", f"timer_attr_id 非法: {timer_attr_id_raw}", 400) from exc

            timer_attr = next((item for item in attrs if int(item["attr_id"]) == timer_attr_id), None)
            if not timer_attr:
                raise ApiError("BAD_REQUEST", f"timer_attr_id 不属于任务: {timer_attr_id}", 400)
            if int(timer_attr["attr_sign"]) != 0 or int(timer_attr["attr_record"]) != 1:
                raise ApiError("BAD_REQUEST", "timer_attr_id 不是可记录的业务属性", 400)
            _, _, ux_config, _ = _parse_calc_payload(timer_attr.get("calc_config"))
            if ux_config["input_type"] != "timer":
                raise ApiError("BAD_REQUEST", "timer_attr_id 对应属性不是 timer 类型", 400)
        else:
            for item in attrs:
                if int(item["attr_sign"]) != 0 or int(item["attr_record"]) != 1:
                    continue
                _, _, ux_config, _ = _parse_calc_payload(item.get("calc_config"))
                if ux_config["input_type"] == "timer":
                    timer_attr_id = int(item["attr_id"])
                    break

        recorded = self.time_repo.record_session(
            task_id=task_id,
            attr_id=timer_attr_id,
            start_time=parsed_start_time.isoformat(),
            record_date=record_day.isoformat(),
            duration_seconds=duration_seconds,
            source_type="task_attr" if timer_attr_id is not None else "task",
        )
        return {
            "task_id": task_id,
            "timer_attr_id": timer_attr_id,
            "focus_attr_id": focus_attr_id,
            "record_date": record_day.isoformat(),
            "duration_seconds": duration_seconds,
            "focus_session_id": recorded["id"],
            "timer_attr_value_today": recorded["attr_value_today"],
            "focus_attr_value_today": recorded["focus_attr_value_today"],
        }

    def batch_upsert_records(self, record_date: str, entries: list[dict]) -> dict:
        target_day = _parse_date_or_raise(record_date)
        if target_day > date.today():
            raise ApiError("BAD_REQUEST", "无法为未来签到", 400)
        if not entries:
            raise ApiError("BAD_REQUEST", "entries 不能为空", 400)

        by_key: dict[tuple[int, int], dict] = {}
        task_attr_cache: dict[int, dict[int, dict]] = {}
        for item in entries:
            task_id = int(item["task_id"])
            attr_id = int(item["attr_id"])
            value = item.get("value")

            if task_id <= 1:
                raise ApiError("BAD_REQUEST", f"task_id 无效: {task_id}", 400)
            if not self.task_repo.task_exists(task_id):
                raise ApiError("NOT_FOUND", f"任务不存在: {task_id}", 404)

            if task_id not in task_attr_cache:
                task_attr_cache[task_id] = {
                    int(attr["attr_id"]): attr for attr in self.task_repo.list_attrs(task_id)
                }
            target = task_attr_cache[task_id].get(attr_id)
            if not target:
                raise ApiError("BAD_REQUEST", f"属性 {attr_id} 不属于任务 {task_id}", 400)
            if int(target["attr_record"]) != 1 or int(target["attr_sign"]) != 0:
                raise ApiError("BAD_REQUEST", f"属性 {attr_id} 不支持记录写入", 400)

            normalized_value: float | None
            if value is None:
                normalized_value = None
            else:
                try:
                    normalized_value = float(value)
                except (TypeError, ValueError) as exc:
                    raise ApiError("BAD_REQUEST", f"value 非法: {value}", 400) from exc

            by_key[(task_id, attr_id)] = {
                "task_id": task_id,
                "attr_id": attr_id,
                "value": normalized_value,
            }

        normalized_entries = list(by_key.values())
        result = self.repo.apply_entries(record_date, normalized_entries)
        return {
            "record_date": record_date,
            "updated": result["updated"],
            "deleted": result["deleted"],
            "entries": len(normalized_entries),
        }
