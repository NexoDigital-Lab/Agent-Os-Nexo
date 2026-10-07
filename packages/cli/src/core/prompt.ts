import { createInterface } from "node:readline/promises";

export interface Asker {
  ask(question: string, fallback: string): Promise<string>;
  close(): void;
}

/** Interactive when stdin is a TTY and --yes was not given; otherwise always returns the default. Tests pass streams. */
export function createAsker(
  nonInteractive: boolean,
  input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Asker {
  if (nonInteractive || !input.isTTY) {
    return { ask: async (_q, fallback) => fallback, close: () => {} };
  }
  const rl = createInterface({ input, output });
  return {
    async ask(question, fallback) {
      const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
      return answer || fallback;
    },
    close: () => rl.close(),
  };
}
