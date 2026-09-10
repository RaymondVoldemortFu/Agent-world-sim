import gzip
import json
from fastapi import APIRouter, HTTPException, Request, Depends
from . import storage

router = APIRouter(prefix="/api/storage")


def name_check(name):
    import re

    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", name):
        raise HTTPException(400, "Invalid experiment name")
    if (storage.ROOT / "artifacts" / name).is_symlink():
        raise HTTPException(400, "Invalid experiment directory")


def local(request: Request):
    from urllib.parse import urlparse

    origin = request.headers.get("origin")
    if origin and urlparse(origin).hostname not in ("localhost", "127.0.0.1", "::1"):
        raise HTTPException(403, "仅限本地实验写入")


async def body(request):
    data = await request.body()
    if request.headers.get("content-encoding") == "gzip":
        import io

        with gzip.GzipFile(fileobj=io.BytesIO(data)) as source:
            data = source.read(64_000_001)
    if len(data) > 64_000_000:
        raise HTTPException(413, "Storage batch too large")
    return json.loads(data)


@router.get("/{name}")
def get_checkpoint(name: str):
    name_check(name)
    try:
        return storage.checkpoint(name)
    except KeyError:
        raise HTTPException(404, "Database experiment not found")


@router.post("/{name}/initialize", dependencies=[Depends(local)])
async def initialize(name: str, request: Request):
    name_check(name)
    data = await body(request)
    duplicate = storage.exists(name)
    if duplicate:
        if storage.checkpoint(name) != data:
            raise HTTPException(409, "Experiment already exists")
    else:
        from starlette.concurrency import run_in_threadpool

        await run_in_threadpool(storage.create, name, data)
    folder = storage.ROOT / "artifacts" / name
    folder.mkdir(exist_ok=True, parents=True)
    (folder / "storage.json").write_text('{"backend":"mysql","version":1}')
    return {"seq": data["world"]["seq"], "duplicate": duplicate}


@router.post("/{name}/commit", dependencies=[Depends(local)])
async def commit(name: str, request: Request):
    name_check(name)
    data = await body(request)
    # Blocking MySQL/JSON work goes to the server thread pool.
    from starlette.concurrency import run_in_threadpool

    try:
        return await run_in_threadpool(
            storage.commit, name, data["expected"], data["checkpoint"], data["entries"]
        )
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.get("/{name}/pending")
def pending(name: str, id: str | None = None):
    name_check(name)
    return storage.load_pending(name, id)


@router.post("/{name}/pending", dependencies=[Depends(local)])
async def save_pending(name: str, request: Request):
    name_check(name)
    from starlette.concurrency import run_in_threadpool

    await run_in_threadpool(storage.save_pending, name, await body(request))
    return {"ok": True}


@router.post("/{name}/metadata", dependencies=[Depends(local)])
async def metadata(name: str, request: Request):
    name_check(name)
    data = await body(request)
    from starlette.concurrency import run_in_threadpool

    await run_in_threadpool(storage.set_metadata, name, data["key"], data["value"])
    return {"ok": True}


# Separate route prefix keeps uploads distinct from named experiment mutations.
imports = APIRouter()


@imports.post("/api/storage-import", dependencies=[Depends(local)])
async def import_file(request: Request):
    import tempfile
    from pathlib import Path
    from starlette.concurrency import run_in_threadpool
    from .storage_import import import_archive

    # Temporary upload only; persistent experiment state is committed to MySQL.
    with tempfile.NamedTemporaryFile(suffix=".archive") as f:
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > 1_000_000_000:
                raise HTTPException(413, "Archive exceeds 1 GB")
            f.write(chunk)
        f.flush()
        try:
            return await run_in_threadpool(import_archive, Path(f.name))
        except (ValueError, KeyError, TypeError, IndexError) as e:
            raise HTTPException(422, f"Invalid delta archive: {e}")
