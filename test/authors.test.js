import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthors, parseWebKit, firefoxEligible } from '../refresh.js';

test('AUTHORS accepts individual emails, not organization patterns or malformed lines', () => {
  const text = `# BEGIN individuals section.
# keep-sorted start
Émilie Example <Emilie@Example.COM>
Another Person <another@example.org>
Another Person <another@example.org>
Malformed <not-an-email>
# END individuals section.
# BEGIN organizations section.
Organization <*@example.com>
# END organizations section.`;
  assert.deepEqual([...parseAuthors(text)].sort(), ['another@example.org', 'emilie@example.com']);
  assert.throws(() => parseAuthors('# missing section'));
});

test('WebKit lists individual emails, not patterns or malformed entries', () => {
  assert.deepEqual([...parseWebKit(JSON.stringify([
    { name: 'Helmut', emails: ['Helmut@Januschka.com', '*@example.com'] },
    { name: 'Another', emails: ['another@example.org'] },
    { name: 'No email', emails: [] }
  ]))].sort(), ['another@example.org', 'helmut@januschka.com']);
  assert.throws(() => parseWebKit('{}'));
});

test('Firefox commit search checks the actual author email, not just result count', async () => {
  const address = 'firefox-test-author@example.invalid';
  const search = async () => ({ ok: true, json: async () => ({ incomplete_results: false, items: [
    { commit: { author: { email: 'someone-else@example.org' } } }
  ] }) });
  assert.equal(await firefoxEligible(address, search), false);
});
