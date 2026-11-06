import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployedScriptUrls, importTag, migrationSql, planImports } from '../scripts/migrate-mux.mjs';

const base = 'https://fixture.supabase.co';
const source = base + '/storage/v1/object/public/pictures/film.mp4';
const row = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', image_url: source };
test('deployment check reads only the site bundle, excluding foreign or inline scripts', () => {
  const urls = deployedScriptUrls('<script type="module" src="/assets/index.js"></script><script src="https://other.test/assets/test.js"></script><script>inline()</script>', 'https://site.test');
  assert.deepEqual(urls.map(url => url.href), ['https://site.test/assets/index.js']);
});
test('shared source imports reuse one slot and resumed imports reuse existing Mux assets', () => {
  const assets = Array.from({ length: 9 }, () => ({}));
  assert.equal(planImports([row, { ...row, id: 'second' }], assets, base).missing.length, 1);
  assets.push({ passthrough: importTag(source) });
  assert.equal(planImports([row], assets, base).missing.length, 0);
  assert.throws(() => planImports([row], Array.from({ length: 10 }, () => ({})), base), /exceed/);
});
test('only portfolio video sources are selected', () => {
  assert.equal(planImports([row, { image_url: source.replace('.mp4', '.jpg') }, { image_url: 'https://other.test/film.mp4' }, { image_url: 'https://stream.mux.com/abc.m3u8' }], [], base).native.length, 1);
});
test('migration SQL is transactional, repeatable, checks original URLs and has a guarded rollback', () => {
  const saved = { ...row, source, state: 'ready', url: 'https://stream.mux.com/playback.m3u8' };
  const sql = migrationSql([saved]);
  assert(sql.includes('BEGIN;'));
  assert(sql.includes('IF NOT EXISTS'));
  assert(sql.includes("AND image_url = '" + source + "'"));
  assert(sql.includes('IF NOT FOUND THEN RAISE EXCEPTION'));
  assert(sql.endsWith('COMMIT;\n'));
  assert(!sql.includes('DELETE'));
  assert(!sql.includes('SET title'));
  assert(migrationSql([saved], true).includes("SET image_url = '" + source + "'"));
  assert.throws(() => migrationSql([{ ...saved, state: 'preparing' }]), /ready/);
});
