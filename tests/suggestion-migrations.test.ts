// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { generateSQLiteDrizzleJson, generateSQLiteMigration, type DrizzleSQLiteSnapshotJSON } from 'drizzle-kit/api';
import * as schema from '../db/schema';

const read = (path: string) => readFileSync(new URL(`../drizzle/${path}`, import.meta.url), 'utf8');
const journal = JSON.parse(read('meta/_journal.json')) as { entries: { idx: number; tag: string }[] };
const snapshot = (index: number) => JSON.parse(read(`meta/${String(index).padStart(4, '0')}_snapshot.json`)) as DrizzleSQLiteSnapshotJSON;

function databaseSchema(database: DatabaseSync) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return tables.map(({ name }) => {
    assert.ok(typeof name === 'string');
    return {
      name,
      columns: database.prepare(`PRAGMA table_info('${name}')`).all(),
      indexes: database.prepare(`PRAGMA index_list('${name}')`).all().map((index) => {
        assert.ok(typeof index.name === 'string');
        return {
          ...index,
          columns: database.prepare(`PRAGMA index_info('${index.name}')`).all(),
        };
      }),
      foreignKeys: database.prepare(`PRAGMA foreign_key_list('${name}')`).all(),
    };
  });
}

void test('journaled suggestion snapshots form a continuous chain and match their actual SQL migrations', async () => {
  for (const index of [8, 9]) {
    const previous = snapshot(index - 1);
    const current = snapshot(index);
    assert.equal(current.prevId, previous.id);
    assert.notEqual(current.id, previous.id);
    const actual = new DatabaseSync(':memory:');
    const generated = new DatabaseSync(':memory:');
    try {
      for (const entry of journal.entries.filter((entry) => entry.idx < index)) {
        const sql = read(`${entry.tag}.sql`);
        actual.exec(sql);
        generated.exec(sql);
      }
      actual.exec(read(`${journal.entries.find((entry) => entry.idx === index)!.tag}.sql`));
      for (const sql of await generateSQLiteMigration(previous, current)) generated.exec(sql);
      assert.deepEqual(databaseSchema(actual), databaseSchema(generated));
    } finally {
      actual.close();
      generated.close();
    }
  }
});

void test('the latest journal snapshot has no migration diff against the current Drizzle schema', async () => {
  const latest = snapshot(9);
  const current = await generateSQLiteDrizzleJson(schema, latest.id);
  assert.deepEqual(await generateSQLiteMigration(latest, current), []);
});
