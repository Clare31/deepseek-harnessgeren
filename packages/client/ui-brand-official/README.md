---
description: "Official DeepSeek Harness brand occupants for the sidebar, active only in official builds; for users and maintainers choosing or replacing brand presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

## Summary

Official builds show Rabb Code as text in OpenAI Sans Medium in the sidebar and conversation headline, with a rounded monochrome rabbit in the conversation hero. A single user-supplied pixel image rotates 90° counterclockwise, covers an 80px header, and fades through T3 Code’s original mask and overlay gradient; attribution is in `ARTWORK-LICENSE.txt`. A localized Settings gear replaces the footer account menu, with keyboard shortcuts and collapsed-rail tooltips. Other profiles retain shell fallbacks. The selection persists in user settings and does not affect model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in the browser roster, then build the client with the `official` profile to register the Rabb Code artwork.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` selects which brand renders. An `official` build fills the sidebar mark, name, decorative header backdrop, and conversation hero mark. Other values leave the declaring packages' fallbacks in place. The conversation headline is Rabb Code in both languages. The plugin loads in either profile; only artwork registration is profile-gated.

### Choosing artwork

Open Settings → Appearance to choose Pixel, Blue Blueprint, or Night. Header and send-button artwork change together after the Host accepts the write. The `ui-brand-official.artwork` setting defaults to `pixel`; the other accepted values are `blueprint` and `night`. A refused or failed save retains the previous choice and shows a retry message.

### Replacing the brand

A deployment with another identity replaces this package with one occupying the sidebar and hero slots. Branding is composed through slots rather than runtime configuration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The sidebar occupants install together through nested `ctx.slots.inject()` calls. The hero mark follows its own declaration lifetime. Each registration works before or after its declarer and is removed when that declaration collapses. The browser half is [`src/client/index.ts`](src/client/index.ts); the Host half validates and persists the artwork selection. A reversible theme-token layer projects the accepted selection to the header and composer. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
