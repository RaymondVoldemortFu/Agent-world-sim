import copy
import unittest
from backend.app.continuous_state import merge_meta
from backend.app.continuous_manor_prompt import MANOR_RULES

class MailPatchTests(unittest.TestCase):
    def test_sparse_mail_survives_other_metadata_changes_without_mutating_events(self):
        letter={'id':'l1','text':'private','status':'held'}
        world={'manor':{'king':{'phase':'collecting'},'letters':[letter]}}
        event={'meta':{'manor':{'king':{'phase':'warning'}}},'mail':[dict(letter,status='delivered')]}
        original=copy.deepcopy(event)
        merge_meta(world,event)
        self.assertEqual(world['manor']['letters'][0]['status'],'delivered')
        self.assertEqual(world['manor']['king']['phase'],'warning')
        self.assertEqual(event,original)
        merge_meta(world,{'meta':{'manor':{'king':{'phase':'expedition'}}}})
        self.assertEqual(world['manor']['letters'][0]['text'],'private')
    def test_legacy_full_manor_and_new_letters(self):
        world={}
        merge_meta(world,{'meta':{'manor':{'letters':[{'id':'old','text':'旧信'}]}}})
        merge_meta(world,{'meta':{},'mail':[{'id':'new','text':'新信'}]})
        self.assertEqual([l['id'] for l in world['manor']['letters']],['old','new'])
        merge_meta(world,{'meta':{'manor':{'letters':[]}}})
        self.assertEqual(world['manor']['letters'],[])
    def test_prompt_describes_real_actions_and_distinct_duties(self):
        for term in ['horse_cart','9999','write_letter','forward_letter','reject_letter','coordinate_error','route_not_found','door_locked','12米','75米','管家雨果 #3','武装税收官罗兰 #2']:
            self.assertIn(term,MANOR_RULES)
        self.assertIn('国王不关心欠税是谁的责任',MANOR_RULES)
