# Approved Runtime Dependencies

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement the exact dependency and offline loading model from the Dependency Policy section after the core compiler exists. Pin Zod `4.4.3`, Day.js `1.11.21`, Cheerio `1.2.0`, and youtubei.js `17.2.0`; expose only explicit SDK entry points; build versioned local runtime modules; and configure Deno import-map resolution under cached-only, no-remote execution.

The compiler must accept approved SDK imports, map them to local runtime modules, and reject direct package, npm, Deno npm, Node, Bun, URL, and computed dynamic imports. Keep the small SDK definition runtime bundled into each script while externalizing the approved dependency modules so large packages are not duplicated in every stored script. Prove module resolution and representative API typing without testing third-party library behavior or making live network calls.

## Acceptance criteria

- [ ] All four approved packages are pinned to the exact versions required by the parent plan
- [ ] The SDK exposes explicit supported entry points for Zod, Day.js including custom parse format, Cheerio, and youtubei.js
- [ ] Approved dependency modules are built ahead of execution and available through a Deno import map in a read-only runtime directory
- [ ] Deno loads each approved dependency with remote access disabled and without contacting a registry
- [ ] Compiled script modules do not duplicate large dependency implementations
- [ ] User compilation rejects direct package, npm, Deno npm, URL, Node, Bun, and computed dynamic imports
- [ ] SDK type fixtures prove approved imports have the pinned package types
- [ ] Deno load tests cover one compiled fixture per approved SDK dependency without asserting library-owned behavior
- [ ] youtubei.js compilation and loading work with its pinned release without live requests
- [ ] Backend startup and package-cache behavior no longer depend on floating unversioned package specifiers
- [ ] Check, tests, and build pass

## User stories addressed

- User story 11
- User story 27
- User story 39
