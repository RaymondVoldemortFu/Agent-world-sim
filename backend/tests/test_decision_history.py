import unittest
from unittest.mock import patch, MagicMock
from contextlib import contextmanager
from backend.app import storage

class DecisionHistoryTest(unittest.TestCase):
    def query(self, rows, **kwargs):
        q=MagicMock();q.fetchall.return_value=rows
        @contextmanager
        def transaction():
            yield q
        with patch.object(storage,'transaction',transaction):
            result=storage.decision_history('test',3,100,80,2,**kwargs)
        return result,q
    def row(self,seq,model=False):
        return {'seq':seq,'day':1,'payload':storage.encode({'id':str(seq),'source':'llm' if model else 'rule','attempts':[{}] if model else [],'decision':{'intent':'test','action':{'type':'wait'}}})}
    def test_cursor_and_boundary(self):
        data,q=self.query([self.row(79),self.row(77),self.row(75)])
        self.assertEqual([r['seq'] for r in data['rows']],[79,77]);self.assertEqual(data['next'],77)
        self.assertEqual(q.execute.call_args.args[1],('test',3,79,3))
    def test_model_filter_advances_when_a_batch_has_no_model_calls(self):
        rows=[self.row(500-i) for i in range(201)]
        data,q=self.query(rows,model_only=True)
        self.assertEqual(data['rows'],[]);self.assertEqual(data['next'],301)
        self.assertEqual(q.execute.call_args.args[1][-1],201)
    def test_model_filter_stops_before_skipping_later_matches(self):
        data,_=self.query([self.row(79),self.row(78,True),self.row(77,True),self.row(76,True)],model_only=True)
        self.assertEqual([r['seq'] for r in data['rows']],[78,77]);self.assertEqual(data['next'],77)
