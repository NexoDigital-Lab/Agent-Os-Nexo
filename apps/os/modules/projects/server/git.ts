// git without the noise: the output, or "" when git fails (not a repo, no upstream, no commits yet).
import { run } from "../../../host/server/http.ts";

export async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}
