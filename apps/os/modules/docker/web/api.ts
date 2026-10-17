import { call } from "@os/lib/http";
import type { TermInfo } from "../../editor/submodules/terminal/server/terminal.ts";
import type { Container, ContainerAction, DockerInfo, Image } from "../server/docker.ts";
import type { DevEnvConfig, DevEnvStatus } from "../server/devenv.ts";
import type { Action as StackAction, Detection, StackConfig, StackStatus } from "../server/compose.ts";
export type { TermInfo } from "../../editor/submodules/terminal/server/terminal.ts";
export type { Container, ContainerAction, DockerCliInfo, DockerInfo, Image } from "../server/docker.ts";
export type { DevEnvConfig, DevEnvStatus, Lang, Detected } from "../server/devenv.ts";
export type { Action as StackAction, Detection, Profile, Service, StackConfig, StackStatus } from "../server/compose.ts";

/** GET /api/tabs/:id/stack */
export type StackInfo = {
  detection: Detection;
  config: StackConfig | null;
  proposed: StackConfig | null;
  /** Profile ids that look like production: starting or stopping them asks for confirmation. */
  prod: string[];
  stacks: { name: string; status: string; files: string[] }[];
  local: boolean;
};

export const dockerApi = {
  info: () => call<DockerInfo>("GET", "/api/docker/info"),
  openDesktop: () => call<{ ok: boolean; path?: string; error?: string }>("POST", "/api/docker/desktop/open"),
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
  stack: (id: string) => call<StackInfo>("GET", `/api/tabs/${id}/stack`),
  saveStack: (id: string, config: StackConfig) => call<StackConfig>("PUT", `/api/tabs/${id}/stack/profiles`, config),
  stackStatus: (id: string, profile: string) => call<StackStatus>("GET", `/api/tabs/${id}/stack/status?profile=${encodeURIComponent(profile)}`),
  stackAction: (id: string, action: StackAction, profile: string, confirm: boolean) => call<{ started: StackAction }>("POST", `/api/tabs/${id}/stack/${action}`, { profile, confirm }),
  stackLogs: (id: string, profile: string, service: string) =>
    call<{ text: string }>("GET", `/api/tabs/${id}/stack/logs?profile=${encodeURIComponent(profile)}&service=${encodeURIComponent(service)}`),
};
