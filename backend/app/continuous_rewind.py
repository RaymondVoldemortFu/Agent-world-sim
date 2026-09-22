"""Offline rewind of a quiescent continuous timeline, with a full per-run backup.

Only tails without new model requests can be removed: context histories then remain valid.
Run after stopping the continuous writer and news gateway.
"""
from .continuous_state import merge_meta
import argparse
import copy
import gzip
import json
import pickle
import socket
from pathlib import Path
from . import storage as s
from .storage_api import name_check

TABLES = {
    'continuous_runs': 'id',
    'continuous_events': 'run_id',
    'continuous_snapshots': 'run_id',
    'continuous_thoughts': 'run_id',
    'continuous_contexts': 'run_id',
    'continuous_experiences': 'run_id',
    'continuous_experience_progress': 'run_id',
    'news_streams': 'experiment',
    'daily_news': 'experiment',
    'news_attempts': 'experiment',
}


def prepare(q, name, cut, expected):
    name_check(name)
    q.execute('SELECT seq,state FROM continuous_runs WHERE id=%s FOR UPDATE', (name,))
    row = q.fetchone()
    if not row or row['seq'] != expected:
        raise ValueError('实验版本发生变化，拒绝回滚')
    original = s.decode(row['state'])
    if original['status'] != 'paused' or not 0 <= cut < expected:
        raise ValueError('回滚需要已暂停的实验和较早的事件边界')
    q.execute("SELECT seq FROM continuous_events WHERE run_id=%s AND seq>%s AND kind='think_started' LIMIT 1", (name, cut))
    if q.fetchone():
        raise ValueError('待移除时间段有模型请求，需要重建上下文，拒绝直接回滚')
    q.execute('SELECT seq,payload FROM continuous_snapshots WHERE run_id=%s AND seq<=%s ORDER BY seq DESC LIMIT 1', (name, cut))
    snap = q.fetchone()
    if not snap:
        raise ValueError('缺少回放快照')
    world = s.decode(snap['payload'])
    q.execute('SELECT payload FROM continuous_events WHERE run_id=%s AND seq>%s AND seq<=%s ORDER BY seq', (name, snap['seq'], cut))
    for row in q.fetchall():
        e = s.decode(row['payload'])
        if e['seq'] != world['seq'] + 1:
            raise ValueError('回放事件不连续')
        for key in ('agents', 'stores', 'fields', 'gates'):
            changed = {v['id']: v for v in e['patch'].get(key, [])}
            world[key] = [changed.pop(v['id'], v) for v in world[key]] + list(changed.values())
        merge_meta(world, e['patch'])
        world.update(seq=e['seq'], time=e['time'])
    if world['seq'] != cut or any(a.get('thinking') for a in world['agents']):
        raise ValueError('回滚点仍有未结算模型请求或边界缺失')
    return world, original


def backup(q, name, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    counts = {}
    # A binary archive retains blobs and MySQL timestamps exactly. Never load untrusted pickle files.
    with path.open('xb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=1) as archive:
            pickle.dump({'version': 1, 'run': name, 'tables': TABLES}, archive)
            for table, key in TABLES.items():
                q.execute(f'SELECT * FROM {table} WHERE {key}=%s', (name,))
                counts[table] = 0
                while rows := q.fetchmany(500):
                    pickle.dump((table, rows), archive)
                    counts[table] += len(rows)
            pickle.dump(None, archive)
        raw.flush()
        import os
        os.fsync(raw.fileno())
    # Verify the archive before deleting any timeline rows.
    verified = {table: 0 for table in TABLES}
    with gzip.open(path, 'rb') as archive:
        header = pickle.load(archive)
        assert header['run'] == name
        while (batch := pickle.load(archive)) is not None:
            table, rows = batch
            verified[table] += len(rows)
    if verified != counts:
        raise ValueError('备份校验失败')
    return counts


def rewind(q, name, cut, world):
    world = copy.deepcopy(world)
    for table in ('continuous_events', 'continuous_snapshots', 'continuous_experiences'):
        q.execute(f'DELETE FROM {table} WHERE run_id=%s AND seq>%s', (name, cut))
    q.execute('UPDATE continuous_experience_progress SET seq=LEAST(seq,%s) WHERE run_id=%s', (cut, name))
    completed = int(world['time'] // 86400000)
    q.execute('DELETE FROM daily_news WHERE experiment=%s AND (day>%s OR boundary>%s)', (name, completed, cut))
    q.execute('DELETE FROM news_attempts WHERE experiment=%s AND day>%s', (name, completed))
    q.execute("UPDATE news_streams SET status='idle',error=NULL WHERE experiment=%s", (name,))
    world.update(seq=cut + 1, status='paused')
    event = {'seq': world['seq'], 'time': world['time'], 'type': 'recovery',
             'text': '恢复到最后一批模型决策与对话结算完毕的时刻，规划继续运行',
             'patch': {'meta': {'seq': world['seq'], 'time': world['time'], 'status': 'paused'}}}
    q.execute('INSERT INTO continuous_events VALUES(%s,%s,%s,NULL,%s,%s)', (name, world['seq'], world['time'], 'recovery', s.encode(event)))
    blob = s.encode(world)
    q.execute('INSERT INTO continuous_snapshots VALUES(%s,%s,%s,%s)', (name, world['seq'], world['time'], blob))
    q.execute('UPDATE continuous_runs SET seq=%s,sim_time=%s,state=%s WHERE id=%s', (world['seq'], world['time'], blob, name))
    return world


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run')
    parser.add_argument('--cut', type=int, required=True)
    parser.add_argument('--expected', type=int, required=True)
    parser.add_argument('--backup', required=True)
    args = parser.parse_args()
    for port in (8001, 8002):
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise ValueError('请先停止连续引擎和网关')
    with s.transaction() as q:
        world, old = prepare(q, args.run, args.cut, args.expected)
        counts = backup(q, args.run, args.backup)
        world = rewind(q, args.run, args.cut, world)
    manifest = {'run': args.run, 'from': {'seq': old['seq'], 'time': old['time']},
                'to': {'seq': world['seq'], 'time': world['time']}, 'backup': args.backup, 'rows': counts}
    Path(args.backup + '.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
