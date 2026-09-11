"""Control the TypeScript runner; checkpoints remain its sole authority."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from uuid import uuid4

from fastapi import HTTPException
from . import storage

ROOT = Path(__file__).resolve().parents[2]
_lock = threading.RLock()
_children: dict[str, subprocess.Popen] = {}


def read(folder: Path, name: str) -> dict:
    if (folder / "storage.json").is_file():
        if name == "checkpoint.json":
            return storage.checkpoint(folder.name)
        if name in ("summary.json", "initial-config.json"):
            return storage.metadata(folder.name, name)
    try:
        return json.loads((folder / name).read_text())
    except (OSError, ValueError):
        return {}


def writer(folder: Path) -> int | None:
    child = _children.get(str(folder))
    if child is not None and child.poll() is not None:
        if child.returncode:
            (folder / "runner-status.json").write_text(
                json.dumps(
                    {
                        "pid": child.pid,
                        "state": "failed",
                        "reason": "运行异常，请查看实验目录中的 runner.log",
                    }
                )
            )
        _children.pop(str(folder), None)  # Reap processes started by this backend.
        child = None
    try:
        pid = int((folder / "runner.lock").read_text())
        if pid <= 0:
            return None
        os.kill(pid, 0)
        return pid
    except (OSError, ValueError):
        return child.pid if child is not None else None


def status(folder: Path, world: dict | None = None) -> dict:
    pid = writer(folder)
    saved = read(folder, "runner-status.json")
    world = world or read(folder, "checkpoint.json").get("world", {})
    reason = ""
    if pid:
        state = (
            "stopping"
            if (
                read(folder, "runner-control.json").get("stopPid") == pid
                or (saved.get("pid") == pid and saved.get("state") == "stopping")
            )
            else "running"
        )
    elif world.get("cursor", {}).get("phase") == "complete":
        state = "completed"
    elif saved.get("state") == "failed":
        state, reason = "failed", saved.get("reason", "运行异常，请查看 runner.log")
    else:
        state = "paused"
        reason = saved.get("reason") or read(folder, "summary.json").get("reason", "")
    current = re.search(
        r"RULES_VERSION = '([^']+)'", (ROOT / "frontend/src/sim/world.ts").read_text()
    )[1]
    compatible = world.get("rulesVersion") == current or (world.get("rulesVersion") == "manor-1.0.0" and bool(world.get("manor"))) or (
        not world.get("ecology") and world.get("rulesVersion") == "mvp-1.7.0"
    )
    if not compatible and state == "paused":
        reason = "此实验使用旧版规则，请开始新实验"
    settings = read(folder, "runner-settings.json")
    return {
        "state": state,
        "reason": reason,
        "canResume": state in ("paused", "failed") and compatible,
        "concurrency": settings.get("concurrency", 6),
        "mode": settings.get("mode", "llm"),
    }


def command(folder: Path, mode: str, concurrency: int) -> list[str]:
    node = shutil.which("node")
    if not node:
        raise HTTPException(503, "未找到 Node.js，无法启动实验")
    return [
        node,
        "--import",
        "tsx",
        str(ROOT / "scripts/simulate.ts"),
        "--out",
        str(folder),
        "--mode",
        mode,
        "--concurrency",
        str(concurrency),
        "--storage",
        os.getenv("SIMULATION_STORAGE")
        or (
            "mysql"
            if (folder / "storage.json").exists()
            or not (folder / "checkpoint.json").exists()
            else "files"
        ),
        "--api",
        os.getenv("SIMULATION_API_URL", "http://127.0.0.1:8000"),
    ]


def launch(folder: Path, mode: str, concurrency: int) -> dict:
    if writer(folder):
        raise HTTPException(409, "实验仍在运行或保存中")
    # A stop request belongs to one process and must never stop a future resume.
    (folder / "runner-control.json").unlink(missing_ok=True)
    with (folder / "runner.log").open("ab") as log:
        child = subprocess.Popen(
            command(folder, mode, concurrency) + ["--resume"],
            cwd=ROOT,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    _children[str(folder)] = child
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if child.poll() is not None:
            if child.returncode:
                raise HTTPException(409, "启动失败，请查看实验目录中的 runner.log")
            return status(folder)
        if (
            read(folder, "runner-status.json").get("pid") == child.pid
            and writer(folder) == child.pid
        ):
            return status(folder)
        time.sleep(0.05)
    # The child owns any eventual checkpoint; don't launch another writer.
    raise HTTPException(503, "启动尚未完成，请稍后刷新状态并检查 runner.log")


def pause(folder: Path) -> dict:
    with _lock:
        pid = writer(folder)
        if pid:
            temp = folder / "runner-control.json.tmp"
            temp.write_text(json.dumps({"stopPid": pid}))
            temp.replace(folder / "runner-control.json")
        return status(folder)


def resume(folder: Path) -> dict:
    with _lock:
        info = status(folder)
        if not info["canResume"]:
            raise HTTPException(
                409, info["reason"] or "实验运行中、保存中或已完成，不能继续"
            )
        mode = read(folder, "runner-settings.json").get("mode") or read(
            folder, "summary.json"
        ).get("mode", "llm")
        if mode not in ("llm", "scripted"):
            raise HTTPException(400, "无效实验模式")
        return launch(folder, mode, info["concurrency"])


def create(artifacts: Path, config: dict, mode: str, concurrency: int) -> dict:
    with _lock:
        name = "web-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:8]
        folder = artifacts / name
        folder.mkdir(parents=True)
        (folder / "initial-config.json").write_text(json.dumps(config))
        try:
            result = subprocess.run(
                command(folder, mode, concurrency)
                + [
                    "--config",
                    str(folder / "initial-config.json"),
                    "--initialize-only",
                ],
                cwd=ROOT,
                capture_output=True,
                timeout=20,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(503, "初始化超时，请检查后台环境")
        (folder / "runner.log").write_bytes(result.stdout + result.stderr)
        if result.returncode:
            raise HTTPException(
                422, "实验配置无效或初始化失败，请检查参数及 runner.log"
            )
        if (folder / "storage.json").exists():
            (folder / "initial-config.json").unlink(missing_ok=True)
        return {"name": name, "control": launch(folder, mode, concurrency)}
