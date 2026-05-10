import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const README_PATH = new URL('../README.md', import.meta.url);

test('README documents layer dependency rule for presentation layer', async () => {
  const readme = await readFile(README_PATH, 'utf8');
  assert.match(readme, /presentation.*application/i);
  assert.doesNotMatch(readme, /presentation.*domain.*direct/i);
});
