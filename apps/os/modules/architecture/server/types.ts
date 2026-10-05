// Shared shapes for the Architecture tab (server ↔ web).

/** One folder of the proposed structure. parentId null = repo root. `rules` = that folder's Markdown rules. */
export type ArchNode = { id: string; name: string; parentId: string | null; rules: string };
export type ArchTree = { nodes: ArchNode[] };

export type ArchStep = { title: string; detail: string; files: string[] }; // files: repo-relative paths that exist
export type ArchAdvice = { mode: "start" | "analyze"; summary: string; steps: ArchStep[]; createdAt: string; cost?: number };

export type ArchChatMsg = { role: "user" | "assistant"; text: string; at: string };

export type ArchDoc = {
  project: string;
  exists: boolean; // an architecture (doc or tree) was saved for this project
  markdown: string; // architecture.md (template when it doesn't exist yet)
  tree: ArchTree;
  advice: ArchAdvice | null;
  chat: ArchChatMsg[];
};
