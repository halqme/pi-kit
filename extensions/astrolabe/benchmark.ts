import { formatBenchmark, runBenchmark } from "./src/benchmark.ts";

const json = process.argv.includes("--json");
const results = await runBenchmark();
console.log(formatBenchmark(results, json ? "json" : "table"));
