import json
import tempfile
import unittest
from pathlib import Path
from backend.app.journal_index import experiences

class ExperiencesTest(unittest.TestCase):
    def test_full_history_sources_agent_isolation_and_incremental_repair(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            def memory(i, source='observed', content=None):
                return dict(id=f'm{i}', day=i, source=source, content=content or f'经历{i}',
                            importance=4, eventIds=[i], speakerId=2 if source=='heard' else None)
            def event(seq, patch):
                return dict(seq=seq, day=seq, type='chat', text='公开事件', patch=patch,
                            decisionId=f'd{seq}', position=[1,2])
            # An older full-state patch repeats m1; a later delta evicts it from the cache.
            events = [event(1, {'agents':[{'id':1,'memories':[memory(1,'heard','早期承诺 ABC%')]},
                                        {'id':2,'memories':[memory(1,'inferred','别人私有判断')]}]}),
                      event(2, {'agents':[{'id':1,'memories':[memory(1,'heard','早期承诺 ABC%'),memory(2)]}]}),
                      event(3, {'agentChanges':[{'state':{'id':1},'memories':{'drop':2,'append':[memory(3,'inferred','个人判断')]}}]}),
                      event(4, {'agentChanges':[{'state':{'id':1},'memories':{'drop':0,'append':[memory(4)]}}]})]
            path = folder/'events.jsonl'
            path.write_text(''.join(json.dumps(e)+'\n' for e in events))
            checkpoint = folder/'checkpoint.json'
            checkpoint.write_text(json.dumps({'world':{'seq':3}}))
            r=experiences(folder,1,limit=2)
            self.assertEqual([m['id'] for m in r['experiences']],['m3','m2'])
            older=experiences(folder,1,limit=2,before=r['nextCursor'],through=r['through'])
            self.assertEqual([m['id'] for m in older['experiences']],['m1'])
            self.assertFalse(older['hasMore'])
            self.assertEqual(experiences(folder,1,q='abc%')['experiences'][0]['source'],'heard')
            self.assertEqual(len(experiences(folder,1,source='heard')['experiences']),1)
            self.assertEqual(experiences(folder,1,start_day=2,end_day=2)['experiences'][0]['id'],'m2')
            self.assertEqual(experiences(folder,1,q='别人私有判断')['experiences'],[])
            self.assertEqual(experiences(folder,2)['experiences'][0]['content'],'别人私有判断')
            self.assertEqual(experiences(folder,1,through=0)['experiences'],[])
            checkpoint.write_text(json.dumps({'world':{'seq':4}}))
            self.assertEqual(experiences(folder,1)['experiences'][0]['id'],'m4')
            tail=json.dumps(event(5,{'agents':[{'id':1,'memories':[memory(5)]}]}))+'\n'
            with path.open('a') as f:f.write(tail[:20])
            checkpoint.write_text(json.dumps({'world':{'seq':5}}))
            self.assertEqual(experiences(folder,1)['experiences'][0]['id'],'m4')
            with path.open('a') as f:f.write(tail[20:])
            self.assertEqual(experiences(folder,1)['experiences'][0]['id'],'m5')
            path.write_text(json.dumps(events[0])+'\n')
            self.assertEqual(len(experiences(folder,1)['experiences']),1)
