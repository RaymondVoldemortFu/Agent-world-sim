import unittest
from backend.app import context_engine as ce

class ManorContextTest(unittest.TestCase):
    def fixture(self, actor=1):
        return {'policy':{'mapSize':24,'dailyAP':5,'rulesVersion':'manor-1.0.0'},'manor':{'nearby':[],'shock':False},'self':{'id':actor,'name':str(actor),'sex':'M','personality':[.5]*5,'biography':f'个人经历 {actor}'}}
    def test_shared_prefix_and_personal_tail(self):
        a,b=ce.fixed(self.fixture(1)),ce.fixed(self.fixture(2))
        self.assertEqual(a[0],b[0])
        self.assertEqual(a[1],b[1])
        self.assertNotEqual(a[2],b[2])
        self.assertIn('中世纪',a[0]['content'])
        self.assertNotIn('250米',a[0]['content'])
        self.assertIn('个人经历 1',a[2]['content'])
    def test_routine_and_receipts_are_incremental_context(self):
        from backend.tests.test_context_engine import observation
        import copy
        o = observation()
        o['manor'] = {'nearby': []}
        o['self']['dailyRoutine'] = {'mode': 'custom', 'eat': True, 'farm': False}
        o['self']['lastTaskResult'] = {'op': 'withdraw', 'position': [20, 5], 'amount': 1}
        initial = ce.observation(o)['content']
        self.assertIn('当前自动日程', initial)
        self.assertIn('最近成功任务回执', initial)
        self.assertNotIn('当前自动日程', ce.observation(o, copy.deepcopy(o))['content'])
        previous = copy.deepcopy(o)
        o['self']['dailyRoutine'] = {'mode': 'off'}
        self.assertIn('当前自动日程', ce.observation(o, previous)['content'])
        self.assertIn('dailyRoutine', ce.fixed(o)[0]['content'])

    def test_every_resident_gets_multiday_ration_and_starvation_warning(self):
        for actor in (1, 2, 7, 8):
            common = ce.fixed(self.fixture(actor))[0]['content']
            self.assertIn('5–10天粮食', common)
            self.assertIn('低于50时应优先进食', common)
            self.assertIn('日末降至0会扣15点血', common)
            self.assertIn('家庭储备', common)
            self.assertIn('manor.nearby', common)
            self.assertIn('没有 contents 字段表示库存未知', common)
            self.assertIn('3.68–7.35kg', common)

    def test_original_scene_retains_original_rules(self):
        o=self.fixture();o.pop('manor')
        self.assertIn('史前',ce.fixed(o)[0]['content'])
    def test_shock_and_local_inventory_do_not_change_prefix(self):
        o=self.fixture();a=ce.fixed(o)
        o['manor']={'shock':True,'nearby':[{'grain':0}]}
        self.assertEqual(a,ce.fixed(o))


class ManorControlTest(unittest.TestCase):
    def test_paused_manor_is_resumable(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from backend.app import experiments
        with TemporaryDirectory() as tmp:
            state = experiments.status(Path(tmp), {'rulesVersion': 'manor-1.0.0', 'manor': {'version': 1}, 'ecology': {'version': 'eco-1'}, 'cursor': {'phase': 'actions'}})
        self.assertTrue(state['canResume'])
    def test_empty_database_listing_accepts_file_archives(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from unittest.mock import patch
        from backend.app import main
        import json
        with TemporaryDirectory() as tmp:
            folder=Path(tmp)/'example';folder.mkdir()
            (folder/'checkpoint.json').write_text(json.dumps({'world':{'metrics':[], 'config':{'days':3,'population':31},'agents':[], 'usage':{'model':'test'},'cursor':{'phase':'complete'}}}))
            with patch.object(main,'ARTIFACTS',Path(tmp)),patch.object(main.storage,'listing',return_value=()),patch.dict('os.environ',{'MYSQL_DATABASE':'configured'}):
                result=main.experiments()
            self.assertEqual(result[0]['name'],'example')
