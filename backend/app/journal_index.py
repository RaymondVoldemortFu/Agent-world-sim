"""Rebuildable, incremental search cache. JSONL remains the simulation authority."""
import hashlib
import json
import sqlite3
import threading
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

EVENT_NAMES = json.loads((Path(__file__).resolve().parents[2] / 'shared/event-names.json').read_text())
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


@contextmanager
def database(folder: Path):
    with _locks_guard:
        lock = _locks.setdefault(str(folder.resolve()), threading.Lock())
    # One index writer per experiment; concurrent requests reuse its completed work.
    with lock:
        db = sqlite3.connect(folder / '.chronicle-v1.sqlite3', timeout=60)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sources (
                    name TEXT PRIMARY KEY, identity TEXT, offset INTEGER,
                    mtime INTEGER, anchor TEXT
                );
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY, type TEXT, searchable TEXT, payload TEXT
                );
                CREATE INDEX IF NOT EXISTS events_type_seq ON events(type, seq);
                CREATE TABLE IF NOT EXISTS decisions (
                    id TEXT PRIMARY KEY, offset INTEGER, length INTEGER
                );
                CREATE TABLE IF NOT EXISTS experiences (
                    id INTEGER PRIMARY KEY, agent_id INTEGER, memory_id TEXT,
                    seq INTEGER, day INTEGER, source TEXT, searchable TEXT, payload TEXT,
                    UNIQUE(agent_id, memory_id)
                );
                CREATE INDEX IF NOT EXISTS experiences_agent ON experiences(agent_id, id);
                CREATE INDEX IF NOT EXISTS experiences_source ON experiences(agent_id, source, id);
            ''')
            yield db
        finally:
            db.close()


def anchor(source, offset: int) -> str:
    source.seek(max(0, offset - 256))
    return hashlib.blake2s(source.read(min(offset, 256))).hexdigest()


def sync(db: sqlite3.Connection, folder: Path, name: str):
    path = folder / ('events.jsonl' if name == 'experiences' else f'{name}.jsonl')
    if not path.exists():
        with db:
            db.execute(f'DELETE FROM {name}')
            db.execute('DELETE FROM sources WHERE name=?', (name,))
        return
    with path.open('rb') as source:
        import os
        stat = os.fstat(source.fileno())
        identity = f'{stat.st_dev}:{stat.st_ino}'
        old = db.execute('SELECT identity, offset, mtime, anchor FROM sources WHERE name=?', (name,)).fetchone()
        offset = old[1] if old else 0
        reset = old and (old[0] != identity or stat.st_size < offset
                         or anchor(source, offset) != old[3]
                         or (stat.st_size == offset and stat.st_mtime_ns != old[2]))
        if old and not reset and stat.st_size == offset:
            return
        with db:
            if reset:
                db.execute(f'DELETE FROM {name}')
                offset = 0
            source.seek(offset)
            # Index only complete lines from this snapshot of the file. A writer can
            # continue appending; its new bytes will be picked up by the next request.
            while source.tell() < stat.st_size:
                start = source.tell()
                line = source.readline()
                if not line.endswith(b'\n') or source.tell() > stat.st_size:
                    break
                try:
                    record = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    break
                if name == 'experiences':
                    patch = record.get('patch', {})
                    memories = [(a['id'], a.get('memories', [])) for a in patch.get('agents', [])]
                    memories += [(a['state']['id'], a.get('memories', {}).get('append', []))
                                 for a in patch.get('agentChanges', [])]
                    for agent_id, entries in memories:
                        for m in entries:
                            payload = {**m, 'agentId': agent_id, 'seq': record['seq'],
                                       'eventType': record['type'], 'decisionId': record.get('decisionId'),
                                       'position': record.get('position')}
                            db.execute('INSERT OR IGNORE INTO experiences '
                                       '(agent_id,memory_id,seq,day,source,searchable,payload) VALUES (?,?,?,?,?,?,?)',
                                       (agent_id, m['id'], record['seq'], m['day'], m['source'],
                                        m['content'].lower(), json.dumps(payload, ensure_ascii=False)))
                elif name == 'events':
                    record.pop('patch', None)
                    kind = record['type']
                    position = ','.join(map(str, record.get('position') or []))
                    searchable = ' '.join([record['text'], kind, EVENT_NAMES.get(kind, ''), position]).lower()
                    db.execute('INSERT OR REPLACE INTO events VALUES (?,?,?,?)',
                               (record['seq'], kind, searchable, json.dumps(record, ensure_ascii=False, separators=(',', ':'))))
                else:
                    db.execute('INSERT OR REPLACE INTO decisions VALUES (?,?,?)',
                               (record['id'], start, len(line)))
                offset = source.tell()
            db.execute('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?)',
                       (name, identity, offset, stat.st_mtime_ns, anchor(source, offset)))


@lru_cache(maxsize=16)
def _checkpoint_seq(path: str, inode: int, size: int, mtime: int) -> int:
    return json.loads(Path(path).read_text())['world']['seq']


def committed_seq(folder: Path) -> int:
    path = folder / 'checkpoint.json'
    stat = path.stat()
    return _checkpoint_seq(str(path), stat.st_ino, stat.st_size, stat.st_mtime_ns)


def search(folder: Path, q: str, event_type: str, limit: int,
           through: int | None, before: int | None) -> dict:
    boundary = committed_seq(folder)
    if through is not None:
        boundary = min(boundary, through)
    upper = min(boundary, before - 1) if before is not None else boundary
    clauses, args = ['seq <= ?'], [upper]
    if event_type:
        clauses.append('type = ?')
        args.append(event_type)
    if q.strip():
        # instr preserves literal substring semantics, including short Chinese words
        # and SQL wildcard characters. Only compact metadata is scanned.
        clauses.append('instr(searchable, ?) > 0')
        args.append(q.strip().lower())
    args.append(limit + 1)
    with database(folder) as db:
        sync(db, folder, 'events')
        rows = db.execute('SELECT payload FROM events WHERE ' + ' AND '.join(clauses)
                          + ' ORDER BY seq DESC LIMIT ?', args).fetchall()
    events = [json.loads(row[0]) for row in rows[:limit]]
    more = len(rows) > limit
    return {'events': events, 'hasMore': more,
            'nextCursor': events[-1]['seq'] if more and events else None, 'through': boundary}


def decision(folder: Path, record_id: str) -> dict | None:
    with database(folder) as db:
        sync(db, folder, 'decisions')
        row = db.execute('SELECT offset, length FROM decisions WHERE id=?', (record_id,)).fetchone()
        if row:
            with (folder / 'decisions.jsonl').open('rb') as source:
                source.seek(row[0])
                record = json.loads(source.read(row[1]))
                if record.get('id') == record_id:
                    return record
    return None


def experiences(folder: Path, agent_id: int, q: str = '', source: str = '',
                start_day: int | None = None, end_day: int | None = None,
                limit: int = 60, through: int | None = None, before: int | None = None) -> dict:
    boundary = committed_seq(folder)
    if through is not None:
        boundary = min(through, boundary)
    clauses, args = ['agent_id=?', 'seq<=?'], [agent_id, boundary]
    for condition, value in [('source=?', source or None), ('day>=?', start_day),
                             ('day<=?', end_day), ('id<?', before),
                             ('instr(searchable,?)>0', q.strip().lower() or None)]:
        if value is not None:
            clauses.append(condition)
            args.append(value)
    with database(folder) as db:
        sync(db, folder, 'experiences')
        rows = db.execute('SELECT id,payload FROM experiences WHERE ' + ' AND '.join(clauses)
                          + ' ORDER BY id DESC LIMIT ?', [*args, limit + 1]).fetchall()
    return {'experiences': [dict(json.loads(payload), cursor=idx) for idx, payload in rows[:limit]],
            'hasMore': len(rows) > limit, 'through': boundary,
            'nextCursor': rows[limit - 1][0] if len(rows) > limit else None}
