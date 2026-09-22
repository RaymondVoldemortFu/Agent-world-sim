import unittest
from backend.app.continuous_day_rewind import reconstruct, history


class DayRewindTest(unittest.TestCase):
    def test_automatic_outcomes_survive_old_model_save_without_duplicates(self):
        from backend.app.continuous_memory import merge_system_memory
        stale = {'prefix': [], 'tail': [{'role':'assistant','content':'old plan'}]}
        merge_system_memory(stale, ['tax paid', 'departed'])
        merge_system_memory(stale, ['tax paid', 'departed'])
        self.assertEqual(len(stale['tail']), 3)
        self.assertEqual(stale['systemMemory'], ['tax paid', 'departed'])

    def test_boundary_cancels_only_inflight_thought_and_keeps_physical_task(self):
        original = {'seq':0,'time':0,'status':'running','agents':[{'id':1,'planVersion':2,'thinking':{'id':'pending'},'nextThink':99,'task':{'kind':'navigate','target':'exit'}}], 'stores':[],'fields':[],'gates':[]}
        events=[{'seq':1,'time':10,'patch':{'meta':{'nextDay':20}}}]
        restored=reconstruct(original, events, 11)
        self.assertEqual(restored['time'],11)
        self.assertEqual(restored['status'],'paused')
        self.assertNotIn('thinking',restored['agents'][0])
        self.assertEqual(restored['agents'][0]['planVersion'],3)
        self.assertEqual(restored['agents'][0]['task']['target'],'exit')
        self.assertIn('thinking',original['agents'][0])
        with self.assertRaises(ValueError):reconstruct(original,events,9)
        with self.assertRaises(ValueError):reconstruct(original,[{'seq':2,'time':10,'patch':{}}],11)

    def test_reconstructed_history_keeps_visibility_and_plan_intent(self):
        event={'seq':1,'time':0,'type':'plan','actor':1,'text':'去粮仓','patch':{'agents':[{'id':1,'task':{'kind':'navigate','target':'keep-store'}}]}}
        speech={'seq':2,'time':1,'type':'speech','actor':2,'listeners':[3],'text':'私下说话','patch':{}}
        rows=history([event,speech])
        self.assertEqual(rows[0]['actor'],1)
        self.assertNotIn('listeners',rows[0])
        self.assertIn('意图不等于执行完成',rows[0]['text'])
        self.assertEqual(rows[1]['listeners'],[3])
        self.assertNotIn('patch',rows[0])

if __name__=='__main__':unittest.main()
