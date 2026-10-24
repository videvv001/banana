import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';

test('events replay by seq with no gaps or duplicates, across reopen', () => {
  const file = `${process.env.TEMP ?? '/tmp'}/vb-test-${process.pid}.db`;
  let s = openStore(file);
  s.createSession('a', '/x');
  s.createSession('b', '/y');
  const seqs = [s.append('a', 'user', { text: '1' }), s.append('b', 'user', { text: '2' }), s.append('a', 'assistant', { n: 3 })].map((e) => e.seq);
  assert.deepEqual(seqs, [1, 2, 3]);
  s.close();
  s = openStore(file); // simulates an agent-host restart
  assert.deepEqual(s.eventsAfter(1).map((e) => e.seq), [2, 3]);
  assert.deepEqual(s.sessionEvents('a').map((e) => e.data), [{ text: '1' }, { n: 3 }]);
  assert.equal(s.append('a', 'result', {}).seq, 4);
  assert.equal(s.maxSeq(), 4);
  s.close();
});
