// nexo self-update: install the CLI from one commit of a Nexo checkout and point the launcher at it (core/selfupdate.ts).
import { findRoot, expandHome } from "../core/paths.ts";
import { defaultLauncher, readCliState, selfUpdate, type Git } from "../core/selfupdate.ts";

export interface SelfUpdateCommandOptions {
  root?: string;
  from?: string;
  ref?: string;
  bin?: string;
}

export function selfUpdateCommand(opts: SelfUpdateCommandOptions, git?: Git, probe?: (entry: string) => string): string {
  const root = findRoot(opts.root);
  const last = readCliState(root);
  const source = opts.from ? expandHome(opts.from) : last?.source;
  if (!source) throw new Error("Usage: nexo self-update --from <nexo checkout> [--ref main|<tag>] [--bin <launcher>] (the checkout is remembered after the first time)");
  const ref = opts.ref ?? last?.ref ?? "main";
  const launcher = opts.bin ? expandHome(opts.bin) : last?.launcher ?? defaultLauncher();
  const { state, changed, files } = selfUpdate({ root, source, ref, launcher, git, probe });
  const short = state.commit.slice(0, 7);
  const what = changed ? `Installed nexo ${state.version} from ${ref} (${short})${files ? `, ${files} files` : ""}.` : `Already on ${ref} (${short}); launcher refreshed.`;
  return `${what}\n  copy: ${state.dir}\n  launcher: ${state.launcher}\nOnly committed files of ${ref} were copied; the checkout itself is never run.`;
}
