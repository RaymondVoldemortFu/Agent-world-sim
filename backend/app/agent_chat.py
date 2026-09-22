"""Isolated, versioned interviews; simulation state/context tables are read-only here."""
import asyncio
import copy
import hashlib
import json
import os
import time
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse
from fastapi.encoders import jsonable_encoder
from . import storage as s
from .storage_api import local, name_check
from .context_engine import persona, tokens

router = APIRouter(prefix='/runs/{name}/chats', dependencies=[Depends(local)])
INTERVIEW = '''
当前进入独立访谈模式。前述世界规则、个人背景与历史消息是你在实验中的认知材料，历史中的动作输出不是本次的输出指令。本次不产生游戏动作，不消耗游戏时间，也不改变其他居民或世界。
你继续扮演该居民，以自己最后保留的认知回答观察者的问题，保留你的性格、利益和理解偏差。区分当时亲历、别人说过、自己的推测，以及观察者在本次访谈新告知的信息。不能访问其他角色的私有记忆或未知的世界事实。不要为了迎合问题假称你当时已知道结果；没有记忆就坦率说明。不假称已执行任何行动。
仅返回JSON对象：{"answer":"对观察者的自然语言回答"}。answer可用段落。此前行动计划JSON格式在访谈中不适用。
'''

LEGACY_OUTPUT = '仅返回JSON对象：{"answer":"对观察者的自然语言回答","rationale_summary":"简明判断依据摘要"}。answer可用段落。需要摘要时只给简明结论依据及不确定性，不输出内部逐步推理或隐藏思维链；不需要摘要时rationale_summary为空字符串。此前行动计划JSON格式在访谈中不适用。'
INTERVIEW_OUTPUT = '仅返回JSON对象：{"answer":"对观察者的自然语言回答"}。answer可用段落。此前行动计划JSON格式在访谈中不适用。'

PLAIN_OUTPUT = '以自然语言直接回答观察者，可分段。此前行动计划JSON格式在访谈中不适用。'

def initialize(q):
    q.execute('''CREATE TABLE IF NOT EXISTS agent_chat_sessions (
      id VARCHAR(36) PRIMARY KEY, run_id VARCHAR(100) NOT NULL, actor INT NOT NULL,
      title VARCHAR(200) NOT NULL, seed LONGBLOB NOT NULL, metadata LONGBLOB NOT NULL,
      revision INT NOT NULL DEFAULT 0, busy VARCHAR(36),
      created TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
      updated TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      KEY agent_sessions(run_id,actor,updated))''')
    q.execute('''CREATE TABLE IF NOT EXISTS agent_chat_turns (
      session_id VARCHAR(36) NOT NULL, id VARCHAR(36) NOT NULL, position INT NOT NULL,
      user_text TEXT NOT NULL, reasoning BOOLEAN NOT NULL, status VARCHAR(20) NOT NULL,
      answer LONGTEXT, summary TEXT, reasoning_content LONGTEXT, error TEXT, usage_json JSON,
      created TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY(session_id,id), UNIQUE KEY turn_order(session_id,position))''')
    q.execute("SHOW COLUMNS FROM agent_chat_turns LIKE 'reasoning_content'")
    if not q.fetchone():
        q.execute("ALTER TABLE agent_chat_turns ADD COLUMN reasoning_content LONGTEXT")


def recover_pending():
    with s.transaction() as q:
        q.execute("UPDATE agent_chat_turns SET status='error',error='服务重启中断了回答，请重试' WHERE status='pending'")
        q.execute('UPDATE agent_chat_sessions SET busy=NULL,revision=revision+1 WHERE busy IS NOT NULL')


def session(q, name, sid, lock=False):
    name_check(name)
    q.execute('SELECT * FROM agent_chat_sessions WHERE id=%s AND run_id=%s'+(' FOR UPDATE' if lock else ''),(sid,name))
    row=q.fetchone()
    if not row: raise HTTPException(404,'会话不存在')
    return row


def public(row):
    return {k:row[k] for k in ('id','actor','title','revision','busy','created','updated')}


def turns(q,sid):
    q.execute('SELECT id,position,user_text,reasoning,status,answer,summary,reasoning_content,error,usage_json,created FROM agent_chat_turns WHERE session_id=%s ORDER BY position',(sid,))
    rows=q.fetchall()
    for r in rows:
        r['reasoning']=bool(r['reasoning'])
        if isinstance(r['usage_json'],str):r['usage_json']=json.loads(r['usage_json'])
    return rows


class Create(BaseModel):
    actor: int = Field(ge=1,le=1000)


@router.get('')
def listing(name: str, actor: int):
    name_check(name)
    with s.transaction() as q:
        q.execute('SELECT id,actor,title,revision,busy,created,updated FROM agent_chat_sessions WHERE run_id=%s AND actor=%s ORDER BY updated DESC,id',(name,actor))
        return q.fetchall()


@router.post('')
def create(name: str, data: Create):
    name_check(name)
    with s.transaction() as q:
        q.execute('SELECT state FROM continuous_runs WHERE id=%s',(name,))
        row=q.fetchone()
        if not row:raise HTTPException(404,'实验不存在')
        world=s.decode(row['state']);agent=next((a for a in world['agents'] if a['id']==data.actor),None)
        if not agent:raise HTTPException(404,'角色不存在')
        q.execute('SELECT payload FROM continuous_contexts WHERE run_id=%s AND actor=%s',(name,data.actor))
        row=q.fetchone()
        if row:
            ctx=s.decode(row['payload']);seed=copy.deepcopy(ctx['prefix']+ctx['tail']);source='persisted_context'
        else:
            seed=[{'role':'system','content':'你是实验中的一名居民。'},
                  {'role':'user','content':persona({'self':{'sex':'未知',**agent}})}]
            source='biography_only'
        if seed and seed[0]['role']=='system':seed[0]['content']+=INTERVIEW
        else:seed.insert(0,{'role':'system','content':INTERVIEW})
        automatic = [m for m in agent.get('systemMemory', []) if not row or m not in ctx.get('systemMemory', [])]
        if automatic:
            seed.append({'role':'user','content':'系统行动记忆：\n'+'\n'.join(automatic)})
        metadata={'name':agent['name'],'dead':agent.get('dead',False),'source':source,
                  'seq':world['seq'],'time':world['time'],'messages':len(seed),
                  'contextWindow':world.get('settings',{}).get('contextWindow',100000),
                  'seedHash':hashlib.sha256(json.dumps(seed,ensure_ascii=False).encode()).hexdigest(),
                  'estimatedTokens':tokens(seed)}
        metadata['lastObservation'] = next((m['content'].split('\n',1)[0].split('。',1)[0]
            for m in reversed(seed) if m['role']=='user' and m['content'].startswith('第 ')),None)
        sid=str(uuid4())
        q.execute('INSERT INTO agent_chat_sessions(id,run_id,actor,title,seed,metadata) VALUES(%s,%s,%s,%s,%s,%s)',
                  (sid,name,data.actor,f'{agent["name"]} · 新访谈',s.encode(seed),s.encode(metadata)))
    return {'id':sid}


@router.get('/{sid}')
def detail(name: str,sid: str):
    with s.transaction() as q:
        row=session(q,name,sid)
        return {**public(row),'metadata':s.decode(row['metadata']),'turns':turns(q,sid)}


class Message(BaseModel):
    requestId: str = Field(pattern=r'^[a-f0-9-]{36}$')
    revision: int = Field(ge=0)
    content: str = Field(min_length=1,max_length=12000)
    reasoning: bool = False
    fromTurn: str | None = None


def prepare(name,sid,data):
    with s.transaction() as q:
        row=session(q,name,sid,True)
        q.execute('SELECT user_text,reasoning FROM agent_chat_turns WHERE session_id=%s AND id=%s',(sid,data.requestId))
        previous=q.fetchone()
        if previous:
            if previous['user_text']!=data.content.strip() or bool(previous['reasoning'])!=data.reasoning:
                raise HTTPException(409,'请求ID已用于不同内容')
            return None
        if row['busy']:raise HTTPException(409,'该会话正在回答，请等待完成')
        if row['revision']!=data.revision:raise HTTPException(409,'会话已更新，请重新加载后操作')
        if not data.content.strip():raise HTTPException(422,'输入不能为空')
        history=turns(q,sid)
        if data.fromTurn:
            target=next((t for t in history if t['id']==data.fromTurn),None)
            if not target:raise HTTPException(404,'待修改消息不存在')
            history=[t for t in history if t['position']<target['position']]
        seed=s.decode(row['seed']);metadata=s.decode(row['metadata']);messages=copy.deepcopy(seed)
        for t in history:
            if t['status']=='done':
                messages += [{'role':'user','content':t['user_text']},
                             {'role':'assistant','content':t['answer']}]
        messages.append({'role':'user','content':data.content.strip()})
        if tokens(messages)>=metadata['contextWindow']:
            raise HTTPException(422,'此会话已达到上下文窗口，请新建会话；历史已保留')
        position=history[-1]['position']+1 if history else 0
        q.execute('DELETE FROM agent_chat_turns WHERE session_id=%s AND position>=%s',(sid,position))
        q.execute("INSERT INTO agent_chat_turns(session_id,id,position,user_text,reasoning,status) VALUES(%s,%s,%s,%s,%s,'pending')",
                  (sid,data.requestId,position,data.content.strip(),data.reasoning))
        q.execute('UPDATE agent_chat_sessions SET busy=%s,revision=revision+1,title=IF(%s=0,%s,title) WHERE id=%s',
                  (data.requestId,position,data.content.strip()[:80],sid))
        return messages


async def provider(app,messages,reasoning,on_delta=None):
    key=os.getenv('DEEPSEEK_API_KEY')
    if not key:raise ValueError('模型密钥未配置')
    messages=copy.deepcopy(messages)
    for message in messages:
        if message['role']=='system':
            message['content']=message['content'].replace(LEGACY_OUTPUT,PLAIN_OUTPUT).replace(INTERVIEW_OUTPUT,PLAIN_OUTPUT)
    answer=thought='';usage={};finished=False
    async with app.state.chat_semaphore:
        async with app.state.chat_client.stream('POST',os.getenv('BASE_URL','https://api.deepseek.com').rstrip('/')+'/chat/completions',
            headers={'Authorization':f'Bearer {key}'},json={'model':os.getenv('MODEL_NAME','deepseek-v4-flash'),
            'messages':messages,'stream':True,'stream_options':{'include_usage':True},
            'thinking':{'type':'enabled' if reasoning else 'disabled'}}) as response:
            if response.status_code!=200:raise ValueError(f'模型服务 HTTP {response.status_code}')
            async for line in response.aiter_lines():
                if not line.startswith('data:'):continue
                payload=line[5:].strip()
                if payload=='[DONE]':break
                if not payload:continue
                data=json.loads(payload)
                if data.get('error'):raise ValueError('模型流式服务返回错误，请重试')
                if data.get('usage'):usage=data['usage']
                for choice in data.get('choices',[]):
                    if choice.get('index',0)!=0:continue
                    delta=choice.get('delta') or {}
                    content=delta.get('content') or ''
                    reasoning_delta=(delta.get('reasoning_content') or '') if reasoning else ''
                    if not isinstance(content,str) or not isinstance(reasoning_delta,str):
                        raise ValueError('模型流式内容格式不正确，请重试')
                    answer+=content;thought+=reasoning_delta
                    if on_delta and (content or reasoning_delta):await on_delta(content,reasoning_delta)
                    reason=choice.get('finish_reason')
                    if reason:
                        if reason!='stop':raise ValueError('模型未完整完成回答，请重试')
                        finished=True
    if not finished:raise ValueError('模型连接提前中断，已保留收到的内容，请重试')
    if not answer.strip():raise ValueError('模型返回了空回答，请重试')
    return answer,thought,usage


def checkpoint(sid,request_id,answer,thought):
    with s.transaction() as q:
        q.execute('SELECT busy FROM agent_chat_sessions WHERE id=%s FOR UPDATE',(sid,))
        row=q.fetchone()
        if not row or row['busy']!=request_id:return False
        q.execute('UPDATE agent_chat_turns SET answer=%s,reasoning_content=%s WHERE session_id=%s AND id=%s',
                  (answer,thought,sid,request_id))
    return True


def sse(event,data):
    return f'event: {event}\ndata: {json.dumps(jsonable_encoder(data),ensure_ascii=False)}\n\n'


def stream_status(name,sid):
    with s.transaction() as q:
        q.execute('SELECT revision,busy FROM agent_chat_sessions WHERE id=%s AND run_id=%s',(sid,name))
        row=q.fetchone()
        if not row:raise HTTPException(404,'会话不存在')
        return row


@router.get('/{sid}/stream')
async def stream(name: str,sid: str,request: Request):
    try:initial=await asyncio.to_thread(detail,name,sid)
    except HTTPException as e:
        if e.status_code!=404:raise
        return StreamingResponse(iter([sse('deleted',{})]),media_type='text/event-stream')
    async def events():
        current=initial;answer=thought='';request_id=None;last_check=0;heartbeat=time.monotonic()
        yield sse('snapshot',current)
        while current['busy']:
            if await request.is_disconnected():return
            live=request.app.state.chat_live.get(sid)
            if live and live['id']==current['busy']:
                if request_id!=live['id']:
                    request_id=live['id'];answer=thought=''
                a,t=live['answer'],live['reasoning_content']
                if a!=answer or t!=thought:
                    yield sse('delta',{'id':request_id,'answerOffset':len(answer.encode('utf-16-le'))//2,'answer':a[len(answer):],
                                     'reasoningOffset':len(thought.encode('utf-16-le'))//2,'reasoning_content':t[len(thought):]})
                    answer,thought=a,t
            now=time.monotonic()
            if now-last_check>=2 or not live:
                last_check=now
                try:latest=await asyncio.to_thread(stream_status,name,sid)
                except HTTPException as e:
                    if e.status_code!=404:raise
                    yield sse('deleted',{});return
                if latest['revision']!=current['revision'] or latest['busy']!=current['busy']:
                    try:current=await asyncio.to_thread(detail,name,sid)
                    except HTTPException as e:
                        if e.status_code!=404:raise
                        yield sse('deleted',{});return
                    request_id=None
                    yield sse('snapshot',current)
            if now-heartbeat>=15:
                yield ': heartbeat\n\n';heartbeat=now
            await asyncio.sleep(.1)
        yield sse('done',{})
    return StreamingResponse(events(),media_type='text/event-stream',headers={
        'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'})


def finish(sid,request_id,answer='',reasoning_content='',usage=None,error=None):
    with s.transaction() as q:
        q.execute('SELECT busy FROM agent_chat_sessions WHERE id=%s FOR UPDATE',(sid,))
        row=q.fetchone()
        if not row or row['busy']!=request_id:return
        q.execute('UPDATE agent_chat_turns SET status=%s,answer=%s,reasoning_content=%s,usage_json=%s,error=%s WHERE session_id=%s AND id=%s',
                  ('error' if error else 'done',answer,reasoning_content,json.dumps(usage or {}),error,sid,request_id))
        q.execute('UPDATE agent_chat_sessions SET busy=NULL,revision=revision+1 WHERE id=%s',(sid,))


async def generate(app,sid,request_id,messages,reasoning):
    live={'id':request_id,'answer':'','reasoning_content':''}
    app.state.chat_live[sid]=live
    last_save=time.monotonic()
    async def publish(answer,thought):
        nonlocal last_save
        live['answer']+=answer;live['reasoning_content']+=thought
        if time.monotonic()-last_save>=2:
            if not await asyncio.to_thread(checkpoint,sid,request_id,live['answer'],live['reasoning_content']):
                raise asyncio.CancelledError()
            last_save=time.monotonic()
    try:
        answer,thought,usage=await provider(app,messages,reasoning,publish)
        await asyncio.to_thread(finish,sid,request_id,answer,thought,usage)
    except asyncio.CancelledError:
        await asyncio.to_thread(finish,sid,request_id,live['answer'],live['reasoning_content'],error='生成已中断，已保留收到的内容，请重试')
        raise
    except Exception as e:
        text=str(e) if isinstance(e,ValueError) and not isinstance(e,json.JSONDecodeError) else f'生成失败（{type(e).__name__}），请重试'
        await asyncio.to_thread(finish,sid,request_id,live['answer'],live['reasoning_content'],error=text)
    finally:
        if app.state.chat_live.get(sid) is live:app.state.chat_live.pop(sid,None)


@router.post('/{sid}/messages')
async def send(name: str,sid: str,data: Message,request: Request):
    messages=await asyncio.to_thread(prepare,name,sid,data)
    if messages is not None:
        task=asyncio.create_task(generate(request.app,sid,data.requestId,messages,data.reasoning))
        request.app.state.chat_tasks.add(task)
        task.add_done_callback(request.app.state.chat_tasks.discard)
    return {'id':data.requestId}


class Delete(BaseModel):
    revision: int = Field(ge=0)
    session: bool = False


@router.post('/{sid}/delete')
def delete(name: str,sid: str,data: Delete):
    with s.transaction() as q:
        row=session(q,name,sid,True)
        if row['revision']!=data.revision:raise HTTPException(409,'会话已更新，请刷新后操作')
        q.execute('DELETE FROM agent_chat_turns WHERE session_id=%s',(sid,))
        if data.session:q.execute('DELETE FROM agent_chat_sessions WHERE id=%s',(sid,))
        else:q.execute('UPDATE agent_chat_sessions SET busy=NULL,revision=revision+1 WHERE id=%s',(sid,))
    return {'ok':True}
