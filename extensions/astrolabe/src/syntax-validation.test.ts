import test from "node:test";
import assert from "node:assert/strict";
import { createTreeEdit, parseSource } from "./parser.ts";
import { findNewSyntaxIssues } from "./syntax-validation.ts";

test("maps an unchanged syntax issue after text is inserted before it", async () => {
  const source = "const broken = ;\nconst answer = 1;\n";
  const before = await parseSource("fixture.ts", source);
  const replacement = "// header\n";
  const edit = createTreeEdit(source, 0, 0, replacement);
  const after = await parseSource("fixture.ts", `${replacement}${source}`, {
    previous: { file: before, edit },
  });
  assert.ok(before.syntaxIssues.length > 0);
  assert.deepEqual(findNewSyntaxIssues(before, after, edit), []);
});

test("detects a new issue even when the total syntax issue count is unchanged", async () => {
  const beforeSource = "const broken = ;\nconst answer = 1;\n";
  const afterSource = "const broken = 1;\nconst answer = ;\n";
  const before = await parseSource("fixture.ts", beforeSource);
  const edit = createTreeEdit(beforeSource, beforeSource.length, beforeSource.length, "");
  const after = await parseSource("fixture.ts", afterSource);
  assert.equal(before.syntaxIssues.length, after.syntaxIssues.length);
  assert.equal(findNewSyntaxIssues(before, after, edit).length, 1);
});

test("does not allow an issue overlapping the edited source to mask a new issue", async () => {
  const source = "function broken() {\n";
  const before = await parseSource("fixture.ts", source);
  const edit = createTreeEdit(source, 0, source.length, source);
  const after = await parseSource("fixture.ts", source, {
    previous: { file: before, edit },
  });
  assert.ok(before.syntaxIssues.length > 0);
  assert.ok(findNewSyntaxIssues(before, after, edit).length > 0);
});
