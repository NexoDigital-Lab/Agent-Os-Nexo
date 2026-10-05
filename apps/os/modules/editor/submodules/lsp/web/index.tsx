// editor/lsp: language servers in the editor (the editor calls useLsp when this submodule is on).
import { defineModule } from "@os/registry";
import { es } from "./messages";

export default defineModule({ messages: { es } });
