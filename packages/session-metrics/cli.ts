#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { analyzeFile, createMetrics, mergeMetrics } from "./src/analyze.ts";

async function sessionFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sessionFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

const target = process.argv[2] ?? join(homedir(), ".pi", "agent", "sessions");
const files = target.endsWith(".jsonl") ? [target] : await sessionFiles(target);
const result = createMetrics();
for (const file of files) mergeMetrics(result, await analyzeFile(file));
console.log(JSON.stringify(result, null, 2));
