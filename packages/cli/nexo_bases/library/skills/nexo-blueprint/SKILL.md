---
name: nexo-blueprint
description: Save a reusable setup or advanced code base as a blueprint, or apply an existing one. Use when the user asks to save something as a blueprint, after finishing something hard to configure, or when a task matches an entry in blueprints/index.json.
owner: nexo
version: 1.0.0
---

# nexo-blueprint

Blueprints are setups that were hard to get right (a monorepo config, an auth server, a mobile
build) stored so the next project gets them right the first time. They live in `blueprints/`, are
the user's, and are not versioned by Nexo.

## Structure (fixed)

```
blueprints/
├── index.json            [{ "name", "description", "tags", "testedWith" }]
└── <name>/
    ├── README.md         when to use it, what it solves, what it does not
    ├── steps.md          numbered steps an agent follows, with decision points
    ├── files/            templates and configs, with {{placeholders}} for project values
    └── verify.md         commands that prove it works, with expected output
```

## Create

1. Only with the user's OK (propose it as a question after a hard setup).
2. Generalize: replace project names, ports, URLs and secrets with `{{placeholders}}`; never copy
   secrets.
3. Record exact versions in `README.md` (`testedWith`).
4. Big setups may be split into sub-blueprints (`<name>/` + `<name>-<part>/`); link them.
5. Add or update the entry in `blueprints/index.json`.

## Apply

1. Read `README.md`; check versions against the project. Different major versions → tell the user.
2. Follow `steps.md` inside `projects/<name>/code/`, adapting placeholders.
3. Run `verify.md`. A blueprint is applied only when verification passes.

## Does not

- Store credentials or personal data in a blueprint.
