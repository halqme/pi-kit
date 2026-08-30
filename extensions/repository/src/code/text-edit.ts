import { randomUUID } from "node:crypto";
import { chmod, rename, stat, unlink, writeFile } from "node:fs/promises";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { requireAdapterForPath } from "../syntax/language-profile.ts";
import {
  cacheFile,
  createTreeEdit,
  parseFile,
  parseSource,
  sourceRange,
  withParserActivity,
} from "../syntax/parser.ts";
import { resolveExistingPath } from "../syntax/path.ts";
import { describeSyntaxIssues, findNewSyntaxIssues } from "../syntax/syntax-validation.ts";

export interface TextEditParams {
  path: string;
  oldText: string;
  newText: string;
}

export type TextEditResult =
  | {
      ok: true;
      path: string;
      language: string;
      replacedBytes: number;
      replacementBytes: number;
    }
  | {
      ok: false;
      code: "old_text_required" | "old_text_not_found" | "old_text_not_unique" | "syntax_error";
      message: string;
    };

function normalizedPath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

export async function editTextDetailed(
  params: TextEditParams,
  cwd: string,
): Promise<TextEditResult> {
  if (params.oldText.length === 0) {
    return {
      ok: false,
      code: "old_text_required",
      message: "oldText must be non-empty so the edit has an exact target.",
    };
  }

  const path = await resolveExistingPath(cwd, normalizedPath(params.path));
  const adapter = requireAdapterForPath(path);

  return withFileMutationQueue(path, () =>
    withParserActivity(async () => {
      const file = await parseFile(path, adapter);
      const startIndex = file.source.indexOf(params.oldText);
      if (startIndex < 0) {
        return {
          ok: false,
          code: "old_text_not_found",
          message: "oldText does not occur in the current file.",
        };
      }
      if (file.source.indexOf(params.oldText, startIndex + params.oldText.length) >= 0) {
        return {
          ok: false,
          code: "old_text_not_unique",
          message: "oldText occurs more than once; provide a larger exact match.",
        };
      }

      const endIndex = startIndex + params.oldText.length;
      const treeEdit = createTreeEdit(file.source, startIndex, endIndex, params.newText);
      const nextSource =
        sourceRange(file.source, 0, startIndex) +
        params.newText +
        sourceRange(file.source, endIndex, file.source.length);
      const checked = await parseSource(path, nextSource, {
        adapter,
        previous: { file, edit: treeEdit },
      });
      const newIssues = findNewSyntaxIssues(file, checked, treeEdit);
      if (newIssues.length > 0) {
        const message = describeSyntaxIssues(newIssues);
        checked.tree.delete();
        return { ok: false, code: "syntax_error", message };
      }

      const originalMode = (await stat(path)).mode & 0o7777;
      const tmp = `${path}.${randomUUID()}.tmp`;
      let renamed = false;
      try {
        await writeFile(tmp, nextSource, "utf8");
        await chmod(tmp, originalMode);
        await rename(tmp, path);
        renamed = true;
        cacheFile(checked);
      } finally {
        if (!renamed) {
          checked.tree.delete();
          await unlink(tmp).catch(() => undefined);
        }
      }

      return {
        ok: true,
        path: params.path,
        language: file.languageId,
        replacedBytes: Buffer.byteLength(params.oldText, "utf8"),
        replacementBytes: Buffer.byteLength(params.newText, "utf8"),
      };
    }),
  );
}
