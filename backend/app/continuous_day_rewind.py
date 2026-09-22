"""Offline day-boundary rewind with verified backup and past-only context reconstruction."""
import argparse
import copy
import json
import socket
import subprocess
import tempfile
from pathlib import Path
from . import storage as s
from .continuous_rewind import backup, rewind
from .continuous_state import merge_meta
from .storage_api import name_check
from .context_engine import persona, tokens

DAY = 86400000


def apply_record(world, event):
    if event['seq'] != world['seq'] + 1:
        raise ValueError('回放事件不连续')
    for key in ('agents', 'stores', 'fields', 'gates'):
        changed = {v['id']: copy.deepcopy(v) for v in event['patch'].get(key, [])}
        world[key] = [changed.pop(v['id'], v) for v in world[key]] + list(changed.values())
    merge_meta(world, event['patch'])
    world.update(seq=event['seq'], time=event['time'])


def reconstruct(world, records, target):
    """Only replay historical events. Never advance through the updated rules."""
    world = copy.deepcopy(world)
    for event in records:
        if event['time'] > target:
            raise ValueError('回放包含未来事件')
        apply_record(world, event)
    world['time'] = target
    world['status'] = 'paused'
    # Cancel only model requests spanning the cut. Physical tasks remain in progress.
    for a in world['agents']:
        if a.pop('thinking', None):
            a['planVersion'] += 1
            a['nextThink'] = target
    return world


def history(records):
    """Preserve actor/listener boundaries; private plans are visible only to their author."""
    result = []
    omit = {'action_started', 'idle', 'body', 'think_started', 'think_finished', 'speaking'}
    for e in records:
        if not e.get('text') or e['type'] in omit:
            continue
        row = {k: v for k, v in e.items() if k != 'patch'}
        if e['type'] == 'plan':
            a = next((a for a in e['patch'].get('agents', []) if a['id'] == e.get('actor')), {})
            effective = {k: a[k] for k in ('task', 'routine', 'combat') if k in a}
            row['text'] += '\n当时接受的计划（意图不等于执行完成）：' + json.dumps(effective, ensure_ascii=False, separators=(',', ':'))
        result.append(row)
    return result


def rebuild_contexts(world, records):
    from .continuous_api import RULES
    from .continuous_manor_prompt import MANOR_RULES
    with tempfile.TemporaryDirectory(prefix='continuous-rewind-') as tmp:
        source, output = Path(tmp)/'input.json', Path(tmp)/'observations.json'
        source.write_text(json.dumps({'world': world, 'events': history(records)}, ensure_ascii=False))
        subprocess.run(['node_modules/.bin/tsx', 'scripts/continuous/rewind-observations.ts', str(source), str(output)], check=True)
        observations = json.loads(output.read_text())
    contexts = {}
    for o in observations:
        context = {
            'prefix': [
                {'role': 'system', 'content': RULES + (MANOR_RULES if world.get('manor') else '')},
                {'role': 'user', 'content': '熟知地图：\n'+o['atlas']},
                {'role': 'user', 'content': persona({'self': o['person']})},
            ],
            'tail': [{'role': 'user', 'content': '以下为截至当前时刻的本人历史事件与可见状态重建。计划仅代表意图，实际成败以随后回执为准；未听到或未亲见的事仍未知。\n'+o['observation']}],
        }
        window = world.get('settings', {}).get('contextWindow', 100000)
        if tokens(context['prefix'] + context['tail']) >= window * .85:
            raise ValueError(f"#{o['actor']} 历史重建超过压缩阈值，需先检查而非截断记忆")
        contexts[o['actor']] = context
    return contexts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run')
    parser.add_argument('--day', type=int, required=True, help='UI day number; D31 begins at 30*DAY')
    parser.add_argument('--expected', type=int, required=True)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    name_check(args.run)
    if args.day < 1:
        raise ValueError('日期必须大于零')
    if args.apply:
        for port in (8001, 8002):
            with socket.socket() as sock:
                if sock.connect_ex(('127.0.0.1', port)) == 0:
                    raise ValueError('执行前请停止连续引擎和网关')
    target = (args.day - 1) * DAY
    with s.transaction() as q:
        q.execute('SELECT state FROM continuous_runs WHERE id=%s FOR UPDATE', (args.run,))
        row = q.fetchone()
        if not row:
            raise ValueError('实验不存在')
        old = s.decode(row['state'])
        if old['seq'] != args.expected or old['status'] != 'paused' or target >= old['time']:
            raise ValueError('需要指定版本的已暂停实验及更早日期')
        q.execute('SELECT payload FROM continuous_snapshots WHERE run_id=%s AND sim_time<=%s ORDER BY seq LIMIT 1', (args.run, target))
        snap = q.fetchone()
        if not snap:
            raise ValueError('缺少初始快照')
        initial = s.decode(snap['payload'])
        q.execute('SELECT payload FROM continuous_events WHERE run_id=%s AND seq>%s AND sim_time<=%s ORDER BY seq', (args.run, initial['seq'], target))
        events = [s.decode(r['payload']) for r in q.fetchall()]
        world = reconstruct(initial, events, target)
        cut = world['seq']
        contexts = rebuild_contexts(world, events)
        manifest = {'run':args.run, 'from':{'seq':old['seq'],'time':old['time']}, 'cut':cut,
                    'day':args.day,'time':target,'contexts':len(contexts),
                    'maxContextTokens':max(tokens(c['prefix']+c['tail']) for c in contexts.values()),
                    'backup':args.backup, 'applied':False}
        if args.apply:
            manifest['rows'] = backup(q, args.run, args.backup)
            # Keep only requests that both started and completed before the boundary.
            active, keep = {}, set()
            for e in events:
                if e['type'] == 'think_started':
                    a = next((a for a in e['patch'].get('agents', []) if a['id'] == e.get('actor')), {})
                    if a.get('thinking'): active[e['actor']] = a['thinking']['id']
                elif e['type'] == 'think_finished' and e.get('actor') in active:
                    keep.add(active.pop(e['actor']))
            q.execute('SELECT request_id FROM continuous_thoughts WHERE run_id=%s', (args.run,))
            remove = [r['request_id'] for r in q.fetchall() if r['request_id'] not in keep]
            if remove:
                q.executemany('DELETE FROM continuous_thoughts WHERE run_id=%s AND request_id=%s', [(args.run,r) for r in remove])
            q.execute('DELETE FROM continuous_contexts WHERE run_id=%s', (args.run,))
            q.executemany('INSERT INTO continuous_contexts VALUES(%s,%s,%s)', [(args.run,a,s.encode(c)) for a,c in contexts.items()])
            world = rewind(q, args.run, cut, world)
            # Explicit full recovery patch includes canceled in-flight requests and exact boundary time.
            event = {'seq':world['seq'],'time':target,'type':'recovery',
                     'text':f'回滚至第{args.day}天00:00；依据该时刻以前本人可见事件重建上下文，实验暂停',
                     'patch':{'agents':world['agents'], 'meta':{'seq':world['seq'],'time':target,'status':'paused'}}}
            q.execute('UPDATE continuous_events SET payload=%s WHERE run_id=%s AND seq=%s', (s.encode(event),args.run,world['seq']))
            manifest.update(applied=True,seq=world['seq'],removedThoughts=len(remove))
    if args.apply:
        Path(args.backup+'.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    print(json.dumps(manifest,ensure_ascii=False))


if __name__ == '__main__':
    main()
