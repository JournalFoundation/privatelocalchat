import test from 'node:test';
import assert from 'node:assert/strict';
import { endpointOptions, getEndpointOptionById, findEndpointOptionForValue, escapeHtml } from '../chat/provider/endpoint-options.mjs';

test('every provider has an id, a label and a hint; ids are unique', () => {
  const ids = endpointOptions.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const o of endpointOptions) { assert.ok(o.id && o.label, o.id); assert.equal(typeof o.hint, 'string'); }
  assert.ok(ids.includes('choose') && ids.includes('custom'));
});
test('an endpoint is matched to its provider, and an unknown one is custom', () => {
  assert.equal(findEndpointOptionForValue('').id, 'choose');
  assert.equal(findEndpointOptionForValue('https://api.openai.com/v1/chat/completions').id, 'openai');
  assert.equal(findEndpointOptionForValue('http://localhost:11434/v1').id, 'ollama');
  assert.equal(findEndpointOptionForValue('https://api.runpod.ai/v2/abc/openai/v1').id, 'runpod');
  assert.equal(findEndpointOptionForValue('https://my.example.org/v1').id, 'custom');
  assert.equal(getEndpointOptionById('nope').id, 'choose');
});
test('escapeHtml escapes the five characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
});
