export interface Metrics { calls: number; inputChars: number; outputChars: number; elapsedMs: number; }
export function record(metrics: Metrics, inputChars: number, output: string, start: number): void { metrics.calls++; metrics.inputChars += inputChars; metrics.outputChars += output.length; metrics.elapsedMs += Date.now() - start; }
