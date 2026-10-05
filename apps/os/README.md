# agent-os

The local app of a Nexo environment: projects, AI sessions as tabs, a full editor, notes and features,
Docker, SSH and more — every part of it a **module** under `modules/<name>/`. One Node.js process on
`127.0.0.1` serves the API and the React app; modules plug into each other through slots and contributions.

## Documentation

All of it is in [`docs/`](docs/README.md), in English and Spanish, and inside the app (the **Docs** view):

| | English | Español |
|---|---|---|
| How it works | [architecture](docs/en/architecture.md) | [arquitectura](docs/es/architecture.md) |
| Writing a module | [module-api](docs/en/module-api.md) | [module-api](docs/es/module-api.md) |
| Module rules | [module-rules](docs/en/module-rules.md) | [module-rules](docs/es/module-rules.md) |
| Reviewing a module | [review](docs/en/review.md) | [review](docs/es/review.md) |
| Every module | [modules](docs/en/modules.md) | [modules](docs/es/modules.md) |
| Install, build, run | [lifecycle](docs/en/lifecycle.md) | [lifecycle](docs/es/lifecycle.md) |
| Security | [security](docs/en/security.md) | [security](docs/es/security.md) |

## Working on it

```bash
npm install                       # once, at the repository root
npm run dev -w apps/os            # this source with hot reload (needs NEXO_ROOT or an environment above)
node scripts/check-modules.ts     # module rules M1–M6 (docs/en/module-rules.md)
npm run docs                      # regenerate docs/README.md after changing a document
npm run check                     # at the root: typecheck + every test (rules and docs included)
```

In an environment, the same code lives in `os/source/` and is run with `nexo os preview`, built with
`nexo os build` and started with `nexo os start` ([lifecycle](docs/en/lifecycle.md)).
