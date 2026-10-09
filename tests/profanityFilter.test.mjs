import assert from 'node:assert/strict';
import test from 'node:test';
import { containsProfanity } from '../dist/data/badWords.js';

test('ordinary words and non-profane phrases do not match', () => {
  for (const message of [
    'delete', 'remove', 'die', 'shut up', 'go die', 'kill yourself',
    'please delete this server', 'remove my role', 'that was stupid',
    'nazi', 'retarded', 'sala', 'con', 'cono',
  ]) {
    assert.equal(containsProfanity(message).matched, false, message);
  }
});

test('actual curse words still match as complete words', () => {
  for (const message of ['fuck', 'what the fuck', 'f-u-c-k', 'shiiiit', 'bhenchod', 'coño']) {
    assert.equal(containsProfanity(message).matched, true, message);
  }
  assert.equal(containsProfanity('Scunthorpe').matched, false);
});
