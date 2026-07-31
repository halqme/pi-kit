export interface Metrics {
  calls: number;
  inputChars: number;
  outputChars: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
  syntaxChecks: number;
  syntaxSuccesses: number;
  typeChecks: number;
  typeCheckSuccesses: number;
  testChecks: number;
  testSuccesses: number;
  retries: number;
  fullParses: number;
  incrementalParses: number;
}

export function createMetrics(): Metrics {
  return {
    calls: 0,
    inputChars: 0,
    outputChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    elapsedMs: 0,
    syntaxChecks: 0,
    syntaxSuccesses: 0,
    typeChecks: 0,
    typeCheckSuccesses: 0,
    testChecks: 0,
    testSuccesses: 0,
    retries: 0,
    fullParses: 0,
    incrementalParses: 0,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function addInput(metrics: Metrics, text: string): void {
  metrics.inputChars += text.length;
  metrics.inputTokens += estimateTokens(text);
}

export function addOutput(metrics: Metrics, text: string): void {
  metrics.outputChars += text.length;
  metrics.outputTokens += estimateTokens(text);
}

export function record(metrics: Metrics, inputChars: number, output: string, start: number): void {
  metrics.calls++;
  metrics.inputChars += inputChars;
  metrics.inputTokens += Math.ceil(inputChars / 4);
  addOutput(metrics, output);
  metrics.elapsedMs += Date.now() - start;
}
