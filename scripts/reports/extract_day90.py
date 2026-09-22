"""Read-only, consistent MySQL extraction for the continuous manor audit."""
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo
import json, hashlib
from backend.app import storage as s

RUN = 'continuous-1789123107617-75b7fc'
OUT = Path('reports/day90/data.json')
DAY = 86400000
RATION = 2500 / 3400

def size(q, table, owner, columns):
    expr = '+'.join(f'COALESCE(OCTET_LENGTH(`{c}`),0)' for c in columns) or '0'
    q.execute(f'SELECT COUNT(*) n,COALESCE(SUM({expr}),0) bytes FROM `{table}` WHERE `{owner}`=%s', (RUN,))
    r = q.fetchone()
    return {'table': table, 'rows': int(r['n']), 'bytes': int(r['bytes']), 'columns': columns}

def main():
    out = {'run': RUN, 'extracted': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()}
    daily = defaultdict(Counter); kinds = Counter(); rejected = Counter(); flows = Counter()
    agent_counts = defaultdict(Counter); deaths = []; important = []; speeches = []
    metrics = []; population = []; health = []; seen = set(); birth = {}
    event_bytes = Counter(); raw_bytes = Counter(); usage = Counter(); attempts = Counter()
    with s.transaction() as q:
        q.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        q.execute('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
        q.execute('SELECT state,seq,sim_time FROM continuous_runs WHERE id=%s', (RUN,))
        head = q.fetchone(); final = s.decode(head['state']); cutoff = min(head['sim_time'], 90 * DAY)
        out['head'] = {'seq': head['seq'], 'time': head['sim_time'], 'cutoff': cutoff, 'status': final['status']}
        out['settings'] = final['settings']
        q.execute('SELECT TABLE_NAME,DATA_LENGTH,INDEX_LENGTH,DATA_FREE,TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()')
        out['physical'] = q.fetchall()
        tables = [('continuous_runs','id',['state']), ('continuous_events','run_id',['payload']),
                  ('continuous_snapshots','run_id',['payload']),('continuous_thoughts','run_id',['payload']),
                  ('continuous_contexts','run_id',['payload']),('continuous_experiences','run_id',['payload','content']),
                  ('continuous_experience_progress','run_id',[]), ('daily_news','experiment',['payload']),
                  ('news_attempts','experiment',['payload']), ('news_streams','experiment',['prefix','error'])]
        out['storage'] = [size(q,*args) for args in tables]
        q.execute('SELECT payload FROM continuous_snapshots WHERE run_id=%s AND seq=0',(RUN,))
        w = s.decode(q.fetchone()['payload']); out['initial'] = json.loads(json.dumps(w))
        arrays = {k:{a['id']:a for a in w[k]} for k in ('agents','stores','fields','gates')}
        initial_ids = {a['id'] for a in w['agents']}
        def status():
            a = list(arrays['agents'].values()); missions = {m['agentId']:m['kind'] for m in w['manor']['missions']}
            return {'x':w['time']/DAY+1, 'locals':sum(not b['dead'] and not b.get('away') for b in a if b['id'] in initial_ids),
                    'army':sum(not b['dead'] and not b.get('away') for b in a if missions.get(b['id'])=='army'),
                    'messenger':sum(not b['dead'] and not b.get('away') for b in a if missions.get(b['id'])=='messenger')}
        def measure(label):
            a = list(arrays['agents'].values()); stores = list(arrays['stores'].values()); fields = list(arrays['fields'].values())
            local = [b for b in a if b['id'] in initial_ids and not b['dead'] and not b.get('away')]
            kings = w['manor']['king']
            metric = {**status(), 'label':label, 'time':w['time'], 'seq':w['seq'],
                'house':sum(s['grain'] for s in stores if s['id'].startswith('home-')),
                'keep':arrays['stores']['keep-store']['grain'], 'tax':arrays['stores']['royal-tax-store']['grain'],
                'public':arrays['stores']['reeve-chest']['grain'], 'allStores':sum(s['grain'] for s in stores),
                'carriedLocal':sum(b['grain'] for b in local), 'corpses':sum(b['grain'] for b in a if b['dead']),
                'allCarried':sum(b['grain'] for b in a), 'fields':sum(f['harvest'] for f in fields),
                'arrears':kings['arrears']*RATION, 'paid':w['manor']['treasury'], 'phase':kings['phase'],
                'overdueSince':kings.get('overdueSince'), 'dueDay':kings['dueDay'],
                'grown':w['ledger']['grown'], 'eaten':w['ledger']['eaten'], 'initialSupply':w['ledger']['initial'],
                'averageHP':sum(b['hp'] for b in local)/max(1,len(local)),
                'averageFood':sum(max(0,b['food']-(w['time']-b['bodyAt'])/DAY*2500)/50 for b in local)/max(1,len(local))}
            metric['balanceResidual'] = metric['initialSupply']+metric['grown']-metric['eaten']-metric['paid']-metric['allStores']-metric['allCarried']-metric['fields']
            metrics.append(metric)
            health.append({'x':metric['x'],'agents':{b['id']:{'hp':b['hp'],'dead':b['dead'],'grain':b['grain']} for b in a}})
        measure('初始'); population.append(status())
        last = 0; gaps=[]; expected=1
        while last < head['seq']:
            q.execute('SELECT seq,payload FROM continuous_events WHERE run_id=%s AND seq>%s AND seq<=%s AND sim_time<=%s ORDER BY seq LIMIT 2000', (RUN,last,head['seq'],cutoff))
            rows=q.fetchall()
            if not rows: break
            for row in rows:
                e=s.decode(row['payload']); typ=e['type']; actor=e.get('actor'); day=min(90,int(e['time']//DAY)+1)
                if row['seq'] != expected: gaps.append([expected,row['seq']])
                expected=row['seq']+1
                patch=e['patch']
                for k in arrays:
                    for a in patch.get(k,[]): arrays[k][a['id']]=a
                w.update(patch['meta']); w['seq']=e['seq']; w['time']=e['time']
                for aid in arrays['agents']:
                    if aid not in seen: seen.add(aid); birth[aid]=e['time']/DAY+1 if aid not in initial_ids else 1
                kinds[typ]+=1; daily[day][typ]+=1; event_bytes[typ]+=len(row['payload'])
                raw_bytes[typ]+=len(json.dumps(e,ensure_ascii=False,separators=(',',':')).encode())
                if actor: agent_counts[actor][typ]+=1
                if typ=='think_finished' and '失败' in e.get('text',''):
                    daily[day]['think_failed']+=1; agent_counts[actor]['think_failed']+=1
                if typ=='plan_rejected': rejected[e.get('text','')]+=1
                if typ=='speech':
                    speeches.append({k:e.get(k) for k in ['seq','time','actor','listeners','text','channel']})
                if typ in ('death','season','royal','control','witness'):
                    important.append({k:e.get(k) for k in ['seq','time','actor','text','type']})
                if typ=='death':
                    a=arrays['agents'][actor]; home=arrays['stores'].get(a['home']);
                    near=[{'id':s['id'],'grain':s['grain'],'accessible':not s.get('lock',{}).get('locked') or s.get('lock',{}).get('hp',1)<=0 or s.get('lock',{}).get('key') in a['keys']} for s in arrays['stores'].values() if ((s['x']-a['x'])**2+(s['y']-a['y'])**2)**.5<=30]
                    deaths.append({'id':actor,'name':a['name'],'time':e['time'],'x':a['x'],'y':a['y'],'seq':e['seq'],'cause':e['text'],'grain':a['grain'],'food':a['food']/50,'home':a['home'],'homeGrain':home['grain'] if home else None,'near':near,'routine':a['routine']})
                    population.append(status())
                if typ=='royal' and ('进入' in e['text'] or '派出' in e['text']): population.append(status())
                if typ=='estate':
                    text=e.get('text','')
                    if text.startswith('攻击 #'): daily[day]['attacks']+=1; agent_counts[actor]['attacks']+=1
                    if '操作失败' in text or '制造失败' in text: daily[day]['operation_failed']+=1
                    if text.startswith('破锁'): daily[day]['breaches']+=1
                if typ=='day_end': measure(e['text'])
            last=rows[-1]['seq']
            if last%20000 <2000: print(f'extracted {last}/{head["seq"]}',flush=True)
        w['time']=cutoff
        measure('截止快照');population.append(status())
        for k in arrays: w[k]=list(arrays[k].values())
        out['final']=w
        out['checks']={'sequenceGaps':gaps,'events':sum(kinds.values()),'replayMatchesFinalAgents':w['agents']==final['agents'], 'maxBalanceResidual':max(abs(m['balanceResidual']) for m in metrics)}
        q.execute('SELECT actor,payload FROM continuous_thoughts WHERE run_id=%s',(RUN,))
        for row in q.fetchall():
            t=s.decode(row['payload']);u=t.get('usage',{});
            for k,v in u.items():
                if isinstance(v,(int,float)):usage[k]+=v
            attempts['requests']+=1
            if t.get('error'):attempts['errorRequests']+=1
            for a in t.get('attempts',[]): attempts[a.get('stage','unknown')]+=1
        q.execute('SELECT payload FROM news_attempts WHERE experiment=%s',(RUN,))
        newsusage=Counter()
        for row in q.fetchall():
            t=s.decode(row['payload'])
            for k,v in t.get('usage',{}).items():
                if isinstance(v,(int,float)):newsusage[k]+=v
        out['newsUsage']=dict(newsusage)
        q.execute("SELECT payload FROM continuous_events WHERE run_id=%s AND kind IN ('estate','plan_rejected') AND seq<=%s ORDER BY seq", (RUN, head['seq']))
        out['operations'] = [{k:e.get(k) for k in ['seq','time','actor','text','type','listeners']} for e in [s.decode(r['payload']) for r in q.fetchall()]]
        q.execute('SELECT actor,payload FROM continuous_contexts WHERE run_id=%s AND actor IN (6,9,26)', (RUN,))
        out['lastHungerContexts'] = {r['actor']:s.decode(r['payload'])['tail'][-4:] for r in q.fetchall()}
    out.update(metrics=metrics,health=health,population=population,deaths=deaths,important=important,speeches=speeches,
               daily=dict(daily),kinds=dict(kinds),agentCounts=dict(agent_counts),rejected=dict(rejected),birth=birth,
               eventBytes=dict(event_bytes),rawEventBytes=dict(raw_bytes),usage=dict(usage),attempts=dict(attempts))
    OUT.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
    print(json.dumps({'output':str(OUT),'bytes':OUT.stat().st_size,'checks':out['checks'],'storage':out['storage'],'deaths':len(deaths),'usage':out['usage']},ensure_ascii=False),flush=True)

if __name__=='__main__': main()
