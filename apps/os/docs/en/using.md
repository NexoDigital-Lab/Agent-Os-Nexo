---
title: Using agent-os-nexo
summary: A tour of the app: projects, session tabs, your notes and terms, the tools around them, and Settings.
group: start
order: 1
---

# Using agent-os-nexo

agent-os-nexo is where you work with your AI agents on the projects of your Nexo environment. Each project
opens in its own tab with a chat, an editor and the project's context, and everything you set up (terms,
permissions, providers, themes) is shared by every agent you run, in the app or in a terminal.

> **Tip:** this guide is about using the app. To change the app itself, start with
> [How agent-os-nexo works](architecture.md) and [Writing a module](module-api.md).

## Open it

From a terminal, inside your environment:

```bash
nexo os start   # runs the active build in the background
nexo os open    # opens it in the browser, signed in for this run
```

Or open the desktop app, which starts the same build on its own. The app only answers on your own machine
(`127.0.0.1`), and only to the link `nexo os open` gives you: see [Security](security.md). Everything else
about starting, stopping and updating is in [Install, build, run](lifecycle.md).

## Find your way

The **rail** on the left has one button per view; the number on a button counts what is waiting for you
(for example a tab that needs an answer). Settings sits at the bottom, with your usage of the plan above it.

| View | What it is for |
|---|---|
| Home | Your projects, recent sessions, goals, an inbox for quick ideas and today's log |
| Tabs | The AI session tabs: one per piece of work, each tied to a project |
| Notes | Free notes per project; an agent turns them into features on a board |
| Dictionary | Your clients, products and jargon, so no agent asks twice what a word means |
| Tools | Docker, SSH, the HTTP client, Extensions and Monitor, each in its own view |

Which views exist depends on the modules you turn on: see [Personalize it](#personalize-it).

## Work with an agent

1. Open a project from Home and start a **tab**. A tab is one conversation with an agent on that project.
2. Write what you want in the composer. The agent reads the project's `AGENTS.md` and `context/` before it
   touches the code, and asks before anything your permissions mark as *ask*.
3. Follow the work in the chat: its sub-agents, the files it changes and what it ran. When it finishes,
   review its changes in the tab before you keep them.
4. Switch the tab's view to the **Editor** to read or change the code yourself, to **Context** for the
   project's documents, or to **Architecture** for the plan the agent must follow.

Past sessions are searchable and can be resumed. The AI behind each tab is chosen in **Providers**:
Claude by default, or another CLI you have installed and enabled.

> **Note:** agents never see `secrets/` and never change what your permissions deny. The rules live in
> `library/permissions.json`, and in a project's `context/permissions.json` on top of it.

## Keep what you know

Agents work better when what you know is written down once:

- **Notes:** dump ideas per project; ask an agent to turn a note into a feature in `context/features/`.
- **Dictionary:** one file per term in `library/dictionary/`. Every agent sees the list.
- **Context:** the project's own documents (specs, decisions, proposals), edited right in its tab.
- **Home inbox:** a line for later, from anywhere.

## Personalize it

Open **Settings** (bottom of the rail):

- **Language** of the app's text. Agents always answer in the language you write in.
- **Appearance:** eight palettes and the fonts.
- **Versions:** the builds of agent-os-nexo you have, and which one loads.
- **Agent permissions:** what agents may do alone, per area, globally or per project.
- **Documentation:** at the very bottom, opens these pages.

The **Modules** view turns parts of the app on and off; a change applies the next time agent-os-nexo starts.
Every module is described in [Modules](modules.md).

## When something goes wrong

- The page says it cannot sign you in: run `nexo os open` again; each run has its own access link.
- A module did not load: the Modules view says why, and the rest of the app keeps working.
- Something looks wrong on screen: take a screenshot into **Visual bugs**, so an agent can find and fix it.
- Anything else: `nexo doctor` checks the environment, and the troubleshooting section of
  [Install, build, run](lifecycle.md) covers the usual cases.
