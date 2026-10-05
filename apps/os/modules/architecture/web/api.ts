import { call, seg } from "@os/lib/http";
import type { ArchAdvice, ArchChatMsg, ArchDoc, ArchTree } from "../server/types.ts";
export type { ArchAdvice, ArchChatMsg, ArchDoc, ArchNode, ArchStep, ArchTree } from "../server/types.ts";

export const archApi = {
  get: (p: string) => call<ArchDoc>("GET", `/api/architecture/${seg(p)}`),
  saveDoc: (p: string, markdown: string) => call("PUT", `/api/architecture/${seg(p)}/doc`, { markdown }),
  saveTree: (p: string, tree: ArchTree) => call<ArchTree>("PUT", `/api/architecture/${seg(p)}/tree`, { tree }),
  importTree: (p: string) => call<ArchTree>("POST", `/api/architecture/${seg(p)}/import`),
  advise: (p: string, mode: "start" | "analyze", lang: string, focus?: string) => call<ArchAdvice>("POST", `/api/architecture/${seg(p)}/advise`, { mode, focus, lang }),
  chat: (p: string, message: string, lang: string) => call<{ reply: string; messages: ArchChatMsg[] }>("POST", `/api/architecture/${seg(p)}/chat`, { message, lang }),
  clearChat: (p: string) => call("DELETE", `/api/architecture/${seg(p)}/chat`),
  setTabArch: (tabId: string, on: boolean) => call("POST", `/api/tabs/${tabId}/architecture`, { on }),
};
