import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from backend.app import journal_index as index


class JournalIndexTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.checkpoint(100)

    def checkpoint(self, seq):
        (self.folder / 'checkpoint.json').write_text(json.dumps({'world': {'seq': seq}}))

    def event(self, seq, text='甲说：一起合作 ABC % _', kind='chat'):
        return json.dumps(dict(seq=seq, type=kind, text=text, position=[2, 3],
                               patch={'large': 'x' * 10000}), ensure_ascii=False) + '\n'

    def search(self, q='', kind='', limit=2, through=None, before=None):
        return index.search(self.folder, q, kind, limit, through, before)

    def test_literal_search_cursor_and_committed_boundaries(self):
        (self.folder / 'events.jsonl').write_text(''.join(self.event(i) for i in range(1, 7)))
        self.checkpoint(5)
        for q in ['合作', '甲', '对话', 'abc', ' 2,3 ', '%', '_']:
            first = self.search(q)
            self.assertEqual([r['seq'] for r in first['events']], [5, 4])
            self.assertEqual(first['nextCursor'], 4)
            second = self.search(q, before=first['nextCursor'], through=first['through'])
            self.assertEqual([r['seq'] for r in second['events']], [3, 2])
            last = self.search(q, before=second['nextCursor'], through=first['through'])
            self.assertEqual([r['seq'] for r in last['events']], [1])
            self.assertFalse(last['hasMore'])
            self.assertNotIn('patch', last['events'][0])
        self.assertEqual(self.search('absent')['events'], [])
        self.assertEqual(self.search(kind='wait')['events'], [])
        self.assertEqual(self.search(through=0)['events'], [])
        self.checkpoint(6)
        self.assertEqual(self.search()['events'][0]['seq'], 6)
        self.assertEqual(self.search(through=5)['events'][0]['seq'], 5)

    def test_incremental_partial_append_and_warm_queries_skip_patches(self):
        path = self.folder / 'events.jsonl'
        line = self.event(2).encode()
        path.write_bytes(self.event(1).encode() + line[:20])
        self.assertEqual(self.search()['events'][0]['seq'], 1)
        with path.open('ab') as stream:
            stream.write(line[20:])
        self.assertEqual(self.search()['events'][0]['seq'], 2)
        original = json.loads
        def loads(value, *args, **kwargs):
            self.assertNotIn('large', str(value))
            return original(value, *args, **kwargs)
        with patch.object(index.json, 'loads', side_effect=loads):
            self.assertEqual(len(self.search()['events']), 2)

    def test_truncation_replacement_and_resume_rewrite_rebuild_cache(self):
        path = self.folder / 'events.jsonl'
        path.write_text(self.event(1) + self.event(2))
        self.search()
        path.write_text(self.event(1, '恢复记录'))
        self.assertEqual(self.search()['events'][0]['text'], '恢复记录')
        replacement = path.with_suffix('.new')
        replacement.write_text(self.event(1, '另一条记录'))
        replacement.replace(path)
        self.assertEqual(self.search()['events'][0]['text'], '另一条记录')
        # A repair can truncate and append beyond the previous index offset.
        path.write_text(self.event(1, '改写后的记录') + self.event(2) + self.event(3))
        self.assertEqual(self.search('改写')['events'][0]['seq'], 1)

    def test_concurrent_first_queries_and_decision_seek(self):
        (self.folder / 'events.jsonl').write_text(''.join(self.event(i) for i in range(1, 51)))
        with ThreadPoolExecutor(max_workers=8) as pool:
            pages = list(pool.map(lambda _: self.search(), range(16)))
        self.assertTrue(all(p['events'][0]['seq'] == 50 for p in pages))
        path = self.folder / 'decisions.jsonl'
        path.write_text(''.join(json.dumps({'id': str(i), 'context': {'private': i}}) + '\n' for i in range(50)))
        self.assertEqual(index.decision(self.folder, '17')['context']['private'], 17)
        self.assertIsNone(index.decision(self.folder, 'missing'))
        with path.open('a') as stream:
            stream.write('{"id":"new"}\n')
        self.assertEqual(index.decision(self.folder, 'new'), {'id': 'new'})
        path.write_text('{"id":"new", "repaired":true}\n')
        self.assertIsNone(index.decision(self.folder, '17'))
        self.assertTrue(index.decision(self.folder, 'new')['repaired'])


if __name__ == '__main__':
    unittest.main()
