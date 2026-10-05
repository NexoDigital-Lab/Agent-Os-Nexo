import { call, seg } from "@os/lib/http";
import type { ArchAdvice, ArchChatMsg, ArchDoc, ArchTree } from "../server/types.ts";
export type { ArchAdvice, ArchChatMsg, ArchDoc, ArchNode, ArchStep, ArchTree } from "../server/types.ts";

export const archApi = {
  get: (p: string) => call<ArchDoc>("GET", `/api/arch/${seg(p)}`),
  saveDoc: (p: string, markdown: string) => call("PUT", `/api/arch/${seg(p)}/doc`, { markdown }),
  saveTree: (p: string, tree: ArchTree) => call<ArchTree>("PUT", `/api/arch/${seg(p)}/tree`, { tree }),
  importTree: (p: string) => call<ArchTree>("POST", `/api/arch/${seg(p)}/import`),
  advise: (p: string, mode: "start" | "analyze", lang: string, focus?: string) => call<ArchAdvice>("POST", `/api/arch/${seg(p)}/advise`, { mode, focus, lang }),
  chat: (p: string, message: string, lang: string) => call<{ reply: string; messages: ArchChatMsg[] }>("POST", `/api/arch/${seg(p)}/chat`, { message, lang }),
  clearChat: (p: string) => call("DELETE", `/api/arch/${seg(p)}/chat`),
  setTabArch: (tabId: string, on: boolean) => call("POST", `/api/tabs/${tabId}/arch`, { on }),
};
