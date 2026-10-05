// Minimal LSP client for Monaco: one per (tab, language), over the server's WebSocket bridge. Covers what you
// feel while coding — diagnostics, completion, hover, signature help, go to definition / references (across files),
// and formatting. Monaco models are file:///<repo-relative path>; the server wants absolute file:// URIs.
import { monaco, languageOf, modelOf } from "../../../web/monaco";
import { editorApi as api } from "../../../web/api";

type Pos = { line: number; character: number };
type LRange = { start: Pos; end: Pos };
type Location = { uri: string; range: LRange };
type LocationLink = { targetUri: string; targetSelectionRange: LRange; targetRange: LRange };

export type LspState = "connecting" | "ready" | "closed" | "missing";

const KINDS = ["", "Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface", "Module", "Property", "Unit", "Value", "Enum", "Keyword", "Snippet", "Color", "File", "Reference", "Folder", "EnumMember", "Constant", "Struct", "Event", "Operator", "TypeParameter"] as const;
const SEVERITY = [monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];

const toRange = (r: LRange) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
const toPos = (p: monaco.IPosition): Pos => ({ line: p.lineNumber - 1, character: p.column - 1 });
const markdown = (c: any): monaco.IMarkdownString[] => {
  if (!c) return [];
  if (Array.isArray(c)) return c.flatMap(markdown);
  if (typeof c === "string") return [{ value: c }];
  if (c.kind) return [{ value: c.kind === "markdown" ? c.value : "```\n" + c.value + "\n```" }];
  if (c.language) return [{ value: "```" + c.language + "\n" + c.value + "\n```" }];
  return [];
};

export class LspClient {
  state: LspState = "connecting";
  private ws: WebSocket;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private docs = new Map<string, { version: number; subs: monaco.IDisposable[]; timer?: number; flush?: () => void }>();
  private subs: monaco.IDisposable[] = [];
  private caps: any = {};

  private tabId: string;
  readonly lang: string;
  private root: string;
  private onState: (s: LspState) => void;

  constructor(tabId: string, lang: string, root: string, onState: (s: LspState) => void) {
    this.tabId = tabId;
    this.lang = lang;
    this.root = root;
    this.onState = onState;
    this.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/tabs/${tabId}/lsp/${lang}`);
    this.ws.onopen = () => this.init();
    this.ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)));
    this.ws.onclose = () => this.set(this.state === "connecting" ? "missing" : "closed");
  }

  private set(s: LspState) {
    this.state = s;
    this.onState(s);
  }

  // ---------- uris ----------
  private abs = (m: monaco.Uri) => `file://${this.root}${m.path}`; // monaco path is "/<rel>"
  private rel = (uri: string) => {
    const p = decodeURIComponent(uri.replace(/^file:\/\//, ""));
    return p.startsWith(this.root + "/") ? p.slice(this.root.length + 1) : null;
  };
  private model = (uri: string) => {
    const r = this.rel(uri);
    return r === null ? null : modelOf(r);
  };

  // ---------- json-rpc ----------
  private send(msg: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  }
  private request<T = any>(method: string, params: object): Promise<T> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
      setTimeout(() => this.pending.delete(id) && resolve(null as T), 15_000);
    });
  }
  private notify(method: string, params: object) {
    this.send({ method, params });
  }
  private receive(msg: any) {
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      return msg.error ? p?.resolve(null) : p?.resolve(msg.result);
    }
    if (msg.method === "textDocument/publishDiagnostics") return this.diagnostics(msg.params);
    // Server → client requests we must answer so it doesn't stall.
    if (msg.id !== undefined) {
      const result = msg.method === "workspace/configuration" ? (msg.params?.items ?? []).map(() => ({})) : null;
      this.send({ id: msg.id, result });
    }
  }

  // ---------- lifecycle ----------
  private async init() {
    const res = await this.request("initialize", {
      processId: null,
      rootUri: `file://${this.root}`,
      workspaceFolders: [{ uri: `file://${this.root}`, name: this.root.split("/").pop() }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          completion: { completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"] } },
          hover: { contentFormat: ["markdown", "plaintext"] },
          signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"] } },
          definition: { linkSupport: true },
          references: {},
          formatting: {},
          publishDiagnostics: { relatedInformation: false },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
    });
    if (!res) return this.set("closed");
    this.caps = res.capabilities ?? {};
    this.notify("initialized", {});
    this.set("ready");
    for (const m of monaco.editor.getModels()) this.track(m);
    this.subs.push(monaco.editor.onDidCreateModel((m) => this.track(m)));
    this.registerProviders();
  }

  private track(m: monaco.editor.ITextModel) {
    if (m.getLanguageId() !== this.lang || this.docs.has(m.uri.toString())) return;
    const doc = { version: 1, subs: [] as monaco.IDisposable[], timer: undefined as number | undefined, flush: undefined as (() => void) | undefined };
    this.docs.set(m.uri.toString(), doc);
    this.notify("textDocument/didOpen", { textDocument: { uri: this.abs(m.uri), languageId: this.lang, version: 1, text: m.getValue() } });
    const send = () => {
      clearTimeout(doc.timer);
      doc.flush = undefined;
      this.notify("textDocument/didChange", { textDocument: { uri: this.abs(m.uri), version: ++doc.version }, contentChanges: [{ text: m.getValue() }] });
    };
    doc.subs.push(
      m.onDidChangeContent(() => {
        clearTimeout(doc.timer);
        doc.flush = send;
        doc.timer = window.setTimeout(send, 150);
      }),
      m.onWillDispose(() => {
        this.notify("textDocument/didClose", { textDocument: { uri: this.abs(m.uri) } });
        doc.subs.forEach((d) => d.dispose());
        this.docs.delete(m.uri.toString());
      }),
    );
  }

  /** Call after writing the file to disk (some servers re-check on save). */
  saved(m: monaco.editor.ITextModel) {
    if (this.docs.has(m.uri.toString())) this.notify("textDocument/didSave", { textDocument: { uri: this.abs(m.uri) }, text: m.getValue() });
  }

  private diagnostics({ uri, diagnostics }: { uri: string; diagnostics: any[] }) {
    const m = this.model(uri);
    if (!m) return;
    monaco.editor.setModelMarkers(
      m,
      "lsp",
      diagnostics.map((d) => ({ startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1, endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1, severity: SEVERITY[d.severity ?? 1], message: d.message, source: d.source, code: d.code ? String(d.code) : undefined })),
    );
  }

  /** Definitions in files that aren't open yet: load them into models so Monaco can peek/jump. */
  private async ensureModel(uri: string): Promise<monaco.Uri | null> {
    const r = this.rel(uri);
    if (r === null) return null; // outside the repo (stdlib, GOROOT…): can't open from here
    const u = monaco.Uri.parse(`file:///${r}`);
    if (!monaco.editor.getModel(u)) {
      const f = await api.readFile(this.tabId, r).catch(() => null);
      if (!f?.exists || monaco.editor.getModel(u)) return monaco.editor.getModel(u) ? u : null;
      monaco.editor.createModel(f.content, languageOf(r), u);
    }
    return u;
  }

  private async locations(res: Location | Location[] | LocationLink[] | null): Promise<monaco.languages.Location[]> {
    const list = !res ? [] : Array.isArray(res) ? res : [res];
    const out: monaco.languages.Location[] = [];
    for (const l of list as any[]) {
      const uri = l.targetUri ?? l.uri;
      const range = l.targetSelectionRange ?? l.range;
      const u = await this.ensureModel(uri);
      if (u) out.push({ uri: u, range: toRange(range) });
    }
    return out;
  }

  private registerProviders() {
    const lang = this.lang;
    // Typing "." asks for completions before the debounced didChange goes out: send pending edits first.
    const doc = (m: monaco.editor.ITextModel) => {
      this.docs.get(m.uri.toString())?.flush?.();
      return { uri: this.abs(m.uri) };
    };
    this.subs.push(
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: this.caps.completionProvider?.triggerCharacters ?? ["."],
        provideCompletionItems: async (m, pos) => {
          const res = await this.request("textDocument/completion", { textDocument: doc(m), position: toPos(pos) });
          const items: any[] = Array.isArray(res) ? res : res?.items ?? [];
          const w = m.getWordUntilPosition(pos);
          const fallback = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
          return {
            incomplete: !Array.isArray(res) && !!res?.isIncomplete,
            suggestions: items.map((it) => {
              const edit = it.textEdit;
              const range = edit ? (edit.range ? toRange(edit.range) : { insert: toRange(edit.insert), replace: toRange(edit.replace) }) : fallback;
              return {
                label: it.label,
                kind: (monaco.languages.CompletionItemKind as any)[KINDS[it.kind ?? 1]] ?? monaco.languages.CompletionItemKind.Text,
                detail: it.detail,
                documentation: markdown(it.documentation)[0],
                insertText: edit?.newText ?? it.insertText ?? it.label,
                insertTextRules: it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                filterText: it.filterText,
                sortText: it.sortText,
                range,
                additionalTextEdits: it.additionalTextEdits?.map((e: any) => ({ range: toRange(e.range), text: e.newText })),
              };
            }),
          };
        },
      }),
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (m, pos) => {
          const res = await this.request("textDocument/hover", { textDocument: doc(m), position: toPos(pos) });
          return res ? { contents: markdown(res.contents), range: res.range ? toRange(res.range) : undefined } : null;
        },
      }),
      monaco.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: this.caps.signatureHelpProvider?.triggerCharacters ?? ["(", ","],
        provideSignatureHelp: async (m, pos) => {
          const res = await this.request("textDocument/signatureHelp", { textDocument: doc(m), position: toPos(pos) });
          if (!res?.signatures?.length) return null;
          return {
            value: {
              signatures: res.signatures.map((s: any) => ({ label: s.label, documentation: markdown(s.documentation)[0], parameters: (s.parameters ?? []).map((p: any) => ({ label: p.label, documentation: markdown(p.documentation)[0] })) })),
              activeSignature: res.activeSignature ?? 0,
              activeParameter: res.activeParameter ?? 0,
            },
            dispose: () => {},
          };
        },
      }),
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (m, pos) => this.locations(await this.request("textDocument/definition", { textDocument: doc(m), position: toPos(pos) })),
      }),
      monaco.languages.registerReferenceProvider(lang, {
        provideReferences: async (m, pos, ctx) => this.locations(await this.request("textDocument/references", { textDocument: doc(m), position: toPos(pos), context: ctx })),
      }),
    );
    if (this.caps.documentFormattingProvider)
      this.subs.push(
        monaco.languages.registerDocumentFormattingEditProvider(lang, {
          displayName: this.lang === "go" ? "gofmt (gopls)" : "LSP",
          provideDocumentFormattingEdits: async (m, opts) => {
            const edits: any[] = (await this.request("textDocument/formatting", { textDocument: doc(m), options: { tabSize: opts.tabSize, insertSpaces: opts.insertSpaces } })) ?? [];
            return edits.map((e) => ({ range: toRange(e.range), text: e.newText }));
          },
        }),
      );
  }

  get canFormat() {
    return !!this.caps.documentFormattingProvider;
  }

  dispose() {
    this.subs.forEach((s) => s.dispose());
    for (const d of this.docs.values()) d.subs.forEach((s) => s.dispose());
    for (const m of monaco.editor.getModels()) monaco.editor.setModelMarkers(m, "lsp", []);
    this.docs.clear();
    this.ws.onclose = null;
    this.ws.close();
  }
}
