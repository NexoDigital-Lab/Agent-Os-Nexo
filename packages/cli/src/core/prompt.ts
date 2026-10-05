import { createInterface } from "node:readline/promises";

export interface Asker {
  ask(question: string, fallback: string): Promise<string>;
  close(): void;
}

/** Interactive when stdin is a TTY and --yes was not given; otherwise always returns the default. */
export function createAsker(nonInteractive: boolean): Asker {
  if (nonInteractive || !process.stdin.isTTY) {
    return { ask: async (_q, fallback) => fallback, close: () => {} };
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async ask(question, fallback) {
      const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
      return answer || fallback;
    },
    close: () => rl.close(),
  };
}
