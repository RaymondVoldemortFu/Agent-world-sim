import asyncio
import copy
import os
import time
import unittest
from uuid import uuid4
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app import agent_chat as chat, storage as s
from backend.app.continuous_api import app

@unittest.skipUnless(os.getenv('MYSQL_TEST')=='1','requires MySQL fixture')
class ChatTests(unittest.TestCase):
    def setUp(self):
        self.name='chat-test-'+uuid4().hex[:12]; self.path='/runs/'+self.name+'/chats'
        self.patches=[patch('backend.app.continuous_news.jobs',return_value=[]),patch.object(chat,'recover_pending')]
        for p in self.patches:p.start()
        self.client=TestClient(app).__enter__();self.calls=[]
        async def fake(app,messages,reasoning,on_delta=None):
            self.calls.append((copy.deepcopy(messages),reasoning))
            return '回答'+str(len(self.calls)),'完整思考\n第二行' if reasoning else '',{'total_tokens':12}
        self.provider=patch.object(chat,'provider',side_effect=fake);self.provider.start()
        self.world={'id':self.name,'seq':0,'time':123,'settings':{'contextWindow':100000},'agents':[
            {'id':1,'name':'死者','sex':'F','dead':True,'biography':'保留身份'},
            {'id':2,'name':'王军','sex':'M','dead':False,'biography':'奉命进攻'}]}
        self.ctx={'prefix':[{'role':'system','content':'world-rules'},{'role':'user','content':'PERSONA'}],
                  'tail':[{'role':'user','content':'最后记忆：粮仓有粮'}]}
        with s.transaction() as q:
            q.execute('INSERT INTO continuous_runs(id,seq,sim_time,state) VALUES(%s,0,123,%s)',(self.name,s.encode(self.world)))
            q.execute('INSERT INTO continuous_contexts VALUES(%s,1,%s)',(self.name,s.encode(self.ctx)))
    def tearDown(self):
        self.client.__exit__(None,None,None);self.provider.stop()
        for p in reversed(self.patches):p.stop()
        with s.transaction() as q:
            q.execute('DELETE t FROM agent_chat_turns t JOIN agent_chat_sessions c ON c.id=t.session_id WHERE c.run_id=%s',(self.name,))
            q.execute('DELETE FROM agent_chat_sessions WHERE run_id=%s',(self.name,))
            for table in ['continuous_contexts','continuous_runs']:
                q.execute(f'DELETE FROM {table} WHERE {"id" if table=="continuous_runs" else "run_id"}=%s',(self.name,))
    def create(self,actor=1):
        r=self.client.post(self.path,json={'actor':actor});self.assertEqual(r.status_code,200,r.text);return r.json()['id']
    def read(self,sid):return self.client.get(self.path+'/'+sid).json()
    def send(self,sid,text,**kw):
        req={'requestId':str(uuid4()),'revision':self.read(sid)['revision'],'content':text,**kw}
        r=self.client.post(self.path+'/'+sid+'/messages',json=req);self.assertEqual(r.status_code,200,r.text)
        for _ in range(100):
            result=self.read(sid)
            if not result['busy']:return result,req
            time.sleep(.01)
        self.fail('generation did not settle')
    def test_dead_agent_independent_frozen_sessions_and_reasoning(self):
        a,b=self.create(),self.create()
        with s.transaction() as q:q.execute('UPDATE continuous_contexts SET payload=%s WHERE run_id=%s',(s.encode({'prefix':[],'tail':[]}),self.name))
        result,_=self.send(a,'只属于A',reasoning=True)
        self.assertTrue(result['metadata']['dead']);self.assertEqual(result['turns'][0]['reasoning_content'],'完整思考\n第二行')
        self.send(b,'只属于B')
        first=' '.join(m['content'] for m in self.calls[0][0]);second=' '.join(m['content'] for m in self.calls[1][0])
        self.assertIn('最后记忆：粮仓有粮',first);self.assertNotIn('只属于A',second)
        self.assertEqual([r[1] for r in self.calls],[True,False])
        self.assertEqual(self.read(b)['turns'][0]['reasoning_content'],'')
        with s.transaction() as q:
            q.execute('SELECT state FROM continuous_runs WHERE id=%s',(self.name,));self.assertEqual(s.decode(q.fetchone()['state']),self.world)
    def test_edit_retry_and_idempotency(self):
        sid=self.create();one,req=self.send(sid,'旧问题')
        self.client.post(self.path+'/'+sid+'/messages',json=req)
        self.assertEqual(len(self.calls),1)
        self.send(sid,'后续问题')
        edited,_=self.send(sid,'新问题',fromTurn=one['turns'][0]['id'])
        self.assertEqual(len(edited['turns']),1)
        history=' '.join(m['content'] for m in self.calls[-1][0])
        self.assertNotIn('旧问题',history);self.assertNotIn('后续问题',history)
        r=self.client.post(self.path+'/'+sid+'/delete',json={'revision':0})
        self.assertEqual(r.status_code,409)
        self.assertEqual(self.client.post(self.path+'/'+sid+'/delete',json={'revision':edited['revision']}).status_code,200)
        self.assertEqual(self.read(sid)['turns'],[])
    def test_failure_retry_and_deleted_pending_cannot_resurrect(self):
        sid=self.create()
        self.provider.stop()
        async def fail(*_):raise ValueError('模型密钥未配置')
        self.provider=patch.object(chat,'provider',side_effect=fail);self.provider.start()
        error,_=self.send(sid,'失败问题')
        self.assertEqual(error['turns'][0]['status'],'error')
        self.assertIn('密钥',error['turns'][0]['error'])
        r=self.client.post(self.path+'/'+sid+'/delete',json={'revision':error['revision'],'session':True})
        self.assertEqual(r.status_code,200)
        chat.finish(sid,error['turns'][0]['id'],answer='迟到回答')
        self.assertEqual(self.client.get(self.path+'/'+sid).status_code,404)
    def test_fallback_and_cross_experiment_access(self):
        sid=self.create(2)
        self.assertEqual(self.read(sid)['metadata']['source'],'biography_only')
        self.assertEqual(self.client.get('/runs/another/chats/'+sid).status_code,404)
        self.assertEqual(self.client.post(self.path,json={'actor':999}).status_code,404)

    def test_partial_failure_is_saved_and_excluded_from_history(self):
        sid=self.create();self.provider.stop()
        async def fail(app,messages,reasoning,on_delta):
            await on_delta('半段回答','思考原文')
            raise ValueError('模型连接提前中断')
        self.provider=patch.object(chat,'provider',side_effect=fail);self.provider.start()
        result,_=self.send(sid,'问题',reasoning=True)
        turn=result['turns'][0]
        self.assertEqual((turn['status'],turn['answer'],turn['reasoning_content']),('error','半段回答','思考原文'))
        self.assertNotIn(sid,app.state.chat_live)
        messages=chat.prepare(self.name,sid,chat.Message(requestId=str(uuid4()),revision=result['revision'],content='下一问'))
        self.assertNotIn('半段回答',str(messages))

    def test_stream_reconnect_snapshot_deltas_and_finish(self):
        from types import SimpleNamespace
        import json
        sid=self.create();rid=str(uuid4())
        chat.prepare(self.name,sid,chat.Message(requestId=rid,revision=0,content='问题'))
        self.assertTrue(chat.checkpoint(sid,rid,'旧片段','旧思考'))
        async def disconnected():return False
        request=SimpleNamespace(app=app,is_disconnected=disconnected)
        async def check():
            app.state.chat_live[sid]={'id':rid,'answer':'答🐻','reasoning_content':'思考'}
            response=await chat.stream(self.name,sid,request);iterator=response.body_iterator
            first=await anext(iterator);self.assertIn('旧片段',first)
            second=await anext(iterator);d=json.loads(second.split('data: ')[1]);self.assertEqual(d['answerOffset'],0);self.assertEqual(d['answer'],'答🐻')
            app.state.chat_live[sid]['answer']+='继续'
            third=await anext(iterator);d=json.loads(third.split('data: ')[1]);self.assertEqual(d['answerOffset'],3);self.assertEqual(d['answer'],'继续')
            chat.finish(sid,rid,'答🐻继续','思考');app.state.chat_live.pop(sid)
            final=await anext(iterator);self.assertIn('snapshot',final);self.assertIn('done',final)
            self.assertIn('event: done',await anext(iterator))
            await iterator.aclose()
        asyncio.run(check())

class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_streams_verbatim_and_upgrades_old_contract(self):
        from types import SimpleNamespace
        from contextlib import asynccontextmanager
        import json
        sent=[];pieces=[]
        thought='思考内容\n' * 20000
        class Response:
            status_code=200
            async def aiter_lines(self):
                yield ': heartbeat'
                for delta in [{'reasoning_content':thought},{'content':'回答🐻'}, {'content':'\n第二行'}]:
                    yield 'data: '+json.dumps({'choices':[{'delta':delta,'finish_reason':None}]})
                yield 'data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}]})
                yield 'data: '+json.dumps({'choices':[],'usage':{'total_tokens':4}})
                yield 'data: [DONE]'
        class Client:
            @asynccontextmanager
            async def stream(self,*a,**kw):sent.append(kw['json']);yield Response()
        app=SimpleNamespace(state=SimpleNamespace(chat_client=Client(),chat_semaphore=asyncio.Semaphore(1)))
        async def publish(a,t):pieces.append((a,t))
        with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'test'}):
            answer,reasoning_content,usage=await chat.provider(app,[{'role':'system','content':chat.LEGACY_OUTPUT},{'role':'user','content':'问题'}],True,publish)
            _,disabled,_=await chat.provider(app,[{'role':'user','content':'问题'}],False)
        self.assertEqual(answer,'回答🐻\n第二行')
        self.assertEqual(reasoning_content,thought)
        self.assertEqual(pieces,[('',thought),('回答🐻',''),('\n第二行','')])
        self.assertEqual(usage,{'total_tokens':4})
        self.assertEqual(sent[0]['messages'][0]['content'],chat.PLAIN_OUTPUT)
        self.assertEqual(sent[0]['messages'][-1]['content'],'问题')
        self.assertEqual(disabled,'')
        self.assertTrue(sent[0]['stream'])
        self.assertEqual(sent[0]['thinking'],{'type':'enabled'})
        self.assertNotIn('max_tokens',sent[0])

    async def test_unfinished_stream_is_failure(self):
        from types import SimpleNamespace
        from contextlib import asynccontextmanager
        class Response:
            status_code=200
            async def aiter_lines(self):
                yield 'data: {"choices":[{"delta":{"content":"半段"}}]}'
        class Client:
            @asynccontextmanager
            async def stream(self,*a,**kw):yield Response()
        app=SimpleNamespace(state=SimpleNamespace(chat_client=Client(),chat_semaphore=asyncio.Semaphore(1)))
        chunks=[]
        async def publish(a,t):chunks.append(a)
        with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'test'}):
            with self.assertRaisesRegex(ValueError,'提前中断'):
                await chat.provider(app,[{'role':'user','content':'问题'}],False,publish)
        self.assertEqual(chunks,['半段'])
