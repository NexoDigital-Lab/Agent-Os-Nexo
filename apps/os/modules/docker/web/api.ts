import { call } from "@os/lib/http";
import type { TermInfo } from "../../editor/submodules/terminal/server/terminal.ts";
import type { Container, ContainerAction, Image } from "../server/docker.ts";
import type { DevEnvConfig, DevEnvStatus } from "../server/devenv.ts";
export type { TermInfo } from "../../editor/submodules/terminal/server/terminal.ts";
export type { Container, ContainerAction, Image } from "../server/docker.ts";
export type { DevEnvConfig, DevEnvStatus, Lang, Detected } from "../server/devenv.ts";

export const dockerApi = {
  info: () => call<{ ok: boolean; version?: string; context?: string; error?: string }>("GET", "/api/docker/info"),
  containers: () => call<Container[]>("GET", "/api/docker/containers"),
  images: () => call<Image[]>("GET", "/api/docker/images"),
  containerAction: (id: string, action: ContainerAction) => call("POST", `/api/docker/containers/${encodeURIComponent(id)}/${action}`),
  containerLogs: (id: string) => call<{ text: string }>("GET", `/api/docker/containers/${encodeURIComponent(id)}/logs`),
  removeImage: (id: string) => call("DELETE", `/api/docker/images/${encodeURIComponent(id)}`),
  pullImage: (image: string) => call<{ digest: string }>("POST", "/api/docker/pull", { image }),
  terms: () => call<TermInfo[]>("GET", "/api/docker/terms"),
  shell: (container: string) => call<TermInfo>("POST", "/api/docker/terms", { container }),
  killTerm: (tid: string) => call("DELETE", `/api/docker/terms/${tid}`),
  devenv: (id: string) => call<DevEnvStatus>("GET", `/api/tabs/${id}/devenv`),
  createDevenv: (id: string, cfg: DevEnvConfig) => call<DevEnvStatus>("POST", `/api/tabs/${id}/devenv`, cfg),
  removeDevenv: (id: string) => call("DELETE", `/api/tabs/${id}/devenv`),
  installDeps: (id: string) => call<TermInfo>("POST", `/api/tabs/${id}/devenv/install`),
};
