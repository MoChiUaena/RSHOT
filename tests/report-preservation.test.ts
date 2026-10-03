import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { composeDaily } from "@aihot/backend/reports/compose";
import { config } from "@aihot/backend/config";
after(closeDb);
test("scheduled reports preserve existing editor content without model requests", async () => {
  const key="2001-01-01";
  const content={sections:[{label:"Local",items:[{title:"Editor work"}]}]};
  await sql`INSERT INTO reports(kind,key,content,origin,window_start,window_end,generated_at) VALUES('daily',${key},${sql.json(content)},'manual','2000-12-31','2001-01-01',now()) ON CONFLICT(kind,key) DO NOTHING`;
  const before = (await sql`SELECT content,origin,revision FROM reports WHERE kind='daily' AND key=${key}`)[0];
  assert.equal((await composeDaily(key,'scheduled')).entries,1);
  assert.deepEqual((await sql`SELECT content,origin,revision FROM reports WHERE kind='daily' AND key=${key}`)[0],before);
  const previous=config.modelCallsEnabled; config.modelCallsEnabled=false;
  try {assert.equal((await composeDaily(key)).entries,1);}finally{config.modelCallsEnabled=previous;}
  const [report]=await sql`SELECT content,origin,revision FROM reports WHERE kind='daily' AND key=${key}`;
  assert.equal(report!.origin,"manual"); assert.deepEqual(report!.content,content); assert.equal(report!.revision,1);
  const preview=await composeDaily(key,"preview",{preview:true});
  assert.equal((preview.content!.generator as {preview:boolean}).preview,true);
  assert.deepEqual((await sql`SELECT content,origin,revision FROM reports WHERE kind='daily' AND key=${key}`)[0],before);
  const [after]=await sql`SELECT content,origin,revision FROM reports WHERE kind='daily' AND key=${key}`;
  assert.deepEqual(after,report,"private drafts do not overwrite the published edition");
});
