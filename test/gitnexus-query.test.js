import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCypherOutput } from '../src/lib/gitnexus-query.js';

describe('parseCypherOutput', () => {
  it('returns empty array for invalid JSON', () => {
    assert.deepStrictEqual(parseCypherOutput('not json'), []);
  });

  it('returns empty array for empty string', () => {
    assert.deepStrictEqual(parseCypherOutput(''), []);
  });

  it('throws on error response', () => {
    assert.throws(
      () => parseCypherOutput(JSON.stringify({ error: 'bad query' })),
      /GitNexus cypher error: bad query/
    );
  });

  it('returns empty array when row_count is 0', () => {
    const input = JSON.stringify({ markdown: '| a |\n| --- |\n', row_count: 0 });
    assert.deepStrictEqual(parseCypherOutput(input), []);
  });

  it('returns empty array when markdown is missing', () => {
    const input = JSON.stringify({ row_count: 5 });
    assert.deepStrictEqual(parseCypherOutput(input), []);
  });

  it('parses simple string values', () => {
    const md = '| name | file |\n| --- | --- |\n| foo | bar.js |';
    const input = JSON.stringify({ markdown: md, row_count: 1 });
    const result = parseCypherOutput(input);
    assert.deepStrictEqual(result, [{ name: 'foo', file: 'bar.js' }]);
  });

  it('parses numeric values', () => {
    const md = '| name | count |\n| --- | --- |\n| foo | 42 |';
    const input = JSON.stringify({ markdown: md, row_count: 1 });
    const result = parseCypherOutput(input);
    assert.deepStrictEqual(result, [{ name: 'foo', count: 42 }]);
  });

  it('parses JSON object values in cells', () => {
    const obj = { id: 'c1', label: 'Test', cohesion: 0.5 };
    const md = `| c |\n| --- |\n| ${JSON.stringify(obj)} |`;
    const input = JSON.stringify({ markdown: md, row_count: 1 });
    const result = parseCypherOutput(input);
    assert.deepStrictEqual(result, [{ c: obj }]);
  });

  it('parses multiple rows', () => {
    const md = '| a | b |\n| --- | --- |\n| x | 1 |\n| y | 2 |\n| z | 3 |';
    const input = JSON.stringify({ markdown: md, row_count: 3 });
    const result = parseCypherOutput(input);
    assert.equal(result.length, 3);
    assert.equal(result[0].a, 'x');
    assert.equal(result[2].b, 3);
  });

  it('handles missing cells gracefully', () => {
    const md = '| a | b | c |\n| --- | --- | --- |\n| x |  |';
    const input = JSON.stringify({ markdown: md, row_count: 1 });
    const result = parseCypherOutput(input);
    assert.equal(result[0].a, 'x');
    assert.equal(result[0].b, '');
  });

  it('handles zero as a number not empty', () => {
    const md = '| val |\n| --- |\n| 0 |';
    const input = JSON.stringify({ markdown: md, row_count: 1 });
    const result = parseCypherOutput(input);
    assert.equal(result[0].val, 0);
  });

  it('handles float values', () => {
    const md = '| score |\n| --- |\n| 0.875 |';
    const input = JSON.stringify({ markdown: md, row_count: 1 });
    const result = parseCypherOutput(input);
    assert.equal(result[0].score, 0.875);
  });

  it('does not parse strings that look like numbers but have text', () => {
    const md = '| val |\n| --- |\n| 42px |';
    const input = JSON.stringify({ markdown: md, row_count: 1 });
    const result = parseCypherOutput(input);
    assert.equal(result[0].val, '42px');
  });

  it('handles malformed JSON in cell gracefully', () => {
    const md = '| val |\n| --- |\n| {broken |';
    const input = JSON.stringify({ markdown: md, row_count: 1 });
    const result = parseCypherOutput(input);
    // Should fall through to string since JSON.parse fails
    assert.equal(result[0].val, '{broken');
  });
});
