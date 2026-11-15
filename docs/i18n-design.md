# Internationalization Design

Approved design, **2026-11-15**, against commit `9b0815e83a`. Nothing here is implemented yet.
This is an engineering reference; once each part ships, the owning package README replaces the
corresponding section.

## Goal

Every user-facing string, whether it comes from the client, a plugin, an error, a notification or
an email, is rendered in the viewer's or recipient's locale. All of this goes through one model,
one runtime and one set of build checks. Plain English strings must not compile where user-facing
text is expected.

## Current state

Localization today covers **content**, not interface text:

- `preferences.language` (nullable ISO 639 code) selects entity translation overlays in
  `kernel/backend/src/modules/entities/localization/`. `packages/languages` owns the ISO catalog.

English is emitted directly from:

| Source | Location |
| --- | --- |
| HTTP errors | `packages/contract/src/errors.ts`: `BadRequest`, `NotFound`, `Conflict`, `RateLimited`, `Unauthorized`, `InternalError`, `SubmissionExpired`, `TimeoutError` carry only `message: string`. About 240 helper calls and 31 direct constructions across the backend. |
| Validation and fallback errors | `kernel/backend/src/boot/server.ts` returns `String(defect.success.cause)` and `internalError(unknownToMessage(error))` to clients. |
| Plugin rejections | `OperationRejectedError({ message })` in `packages/plugin-backend-sdk/src/operation.ts`, with English call sites in plugins. |
| Notifications | Plugin automations, such as `plugins/media/backend/automations/notification.sandbox.ts`, build English sentences and call `host.sendNotification(string)`. Delivery adds an English subject (`` `${PROJECT_NAME} notification` ``). |
| Manifests | `label`, `title` and `description` are `Schema.NonEmptyString`. |
| UI | Inline JSX text in `kernel/client`, `packages/plugin-ui-sdk`, `packages/plugin-client-sdk` and plugin clients. `REPORTING_LOCALE = "en-US"` in `packages/plugin-ui-sdk/src/metric-format.ts`. The client renders `error.message` directly. |

`SandboxBoundaryReason` (`packages/contract/src/modules/scripts/boundary-reason.ts`) already
returns codes instead of sentences. This design applies that pattern everywhere.

## Model

User-facing text crosses every boundary (HTTP, iframe bridge, sandbox host calls, the database)
as a **message**, never as a rendered string:

```ts
{ namespace, key, params }
```

- `namespace` is `kernel` or the plugin ID. For plugin-originated messages the kernel stamps the
  namespace from the run's authority, so a plugin cannot reference another plugin's catalog. The
  kernel resolves `(namespace, key)` against the catalog registry and never branches on plugin IDs.
- `params` are typed values: string, number, date, a closed code (rendered by the catalog through
  `select`), or a nested message. Enumerated values such as statuses are codes, never English.
- Rendering happens only at the edge: the browser, a plugin iframe, or the backend notification
  and email delivery job, in the viewer's or recipient's locale.

## Packages

### `packages/i18n` (environment-neutral)

- Message schema and typed builders.
- Catalog registry keyed by namespace, with locale negotiation and a fallback chain
  (`pt-BR → pt → en`). A missing key falls back to English.
- `format(registry, locale, message)` over the runtime engine, plus cached `Intl` number, date,
  relative-time and list formatters. These replace `REPORTING_LOCALE` and
  `Intl.DateTimeFormat(undefined, …)`.
- A React binding (`I18nProvider`, `useT()`) shared by `kernel/client` and plugin iframes.
- The catalog build step: parse, validate, convert, and generate types (see
  [Catalogs and build](#catalogs-and-build)).

### `packages/kernel-messages`

The kernel catalogs: error codes, kernel UI copy, notification and email templates, validation
issues, and the `plugin-ui-sdk` component copy ("Retry", "Load more"). Copy stays product-agnostic.
`contract` references its keys, `kernel/client` renders them, and the backend renders them during
delivery.

## Engine

- **Syntax:** ICU MessageFormat 1, so plural, select and selectordinal work, with native
  `Intl.PluralRules`.
- **Build:** `@formatjs/icu-messageformat-parser` parses source messages into a JSON AST.
- **Runtime:** `intl-messageformat` formats the pre-parsed AST. The parser is not shipped to the
  browser, iframes or server.

Catalogs ship as data, never as executable code. Plugin catalogs come from untrusted archives and
are rendered by trusted kernel code, so compiler-to-function tools are excluded.

| Alternative | Decision |
| --- | --- |
| Paraglide | Rejected: it compiles messages to JavaScript functions, so plugin catalogs would be executable code. |
| Lingui | Rejected: it centres on extracting messages from source code; runtime compilation is stripped from production by default. |
| i18next + ICU plugin | Rejected: ICU sits on top of its own format, and its namespace and loading system duplicates `packages/i18n`. |
| react-intl | Unnecessary: `useT()` over `intl-messageformat` covers both the kernel client and plugin iframes. |
| `messageformat` v4 (MessageFormat 2) | Deferred: `Intl.MessageFormat` is at TC39 Stage 1, and translation-tool support is minimal. |
| `icu-minify` | Watched: its data IR and small runtime fit the design, but it is experimental and lives in the next-intl monorepo. |

All formatting goes through `packages/i18n`, so replacing the engine changes only the build step
and the formatter, not any call site.

## Catalogs and build

- **Sources:** one ICU JSON file per locale. Kernel catalogs live in `packages/kernel-messages`;
  plugin catalogs live in `plugins/<plugin>/shared/messages/<locale>.json` and are declared in the
  manifest.
- **English is the source locale.** An entry may carry an optional translator description saying
  where the string appears and what its parameters mean.
- **Build** (`ryot plugin build` and the kernel check) fails on:
  - invalid ICU syntax;
  - a key or placeholder mismatch against English, or a parameter-type mismatch;
  - keys absent from English;
  - message references in code or manifests that have no English key;
  - unused English keys.

  The build also reports missing keys per locale without failing. It emits the parsed catalogs as
  JSON and generates TypeScript key and parameter types from English. The shared validation lives
  beside the definition-set validation in `packages/definitions`.
- **Archives** carry the compiled catalogs. The backend stores them with the installation and
  serves them to the client.
- **Translation workflow:** contributors edit locale JSON files through pull requests. CI runs the
  checks above, so reviewers judge only wording. No translation-management platform is used. The
  files use a standard layout, so one can be added later without changes.

## Errors

- Contract error classes remove `message: string` and carry `reason: Message`. They exist only to
  select HTTP status. Helpers such as `badRequest` accept only messages.
- `decodeErrorsAsBadRequest` returns `validation.invalid` with structured `{ path, issue }` entries
  derived from Effect Schema issues. The router fallback returns `internal.unexpected`.
  Diagnostics go only to logs and spans.
- `SandboxBoundaryReason` moves into the message model.
- `OperationRejectedError` carries `reason: Message` from the plugin's own catalog, exposed through
  `plugin-backend-sdk`.
- Internal tagged errors that never cross a boundary stay as they are.
- The client renders every error through one `formatError`. Background-submission state stores the
  message, not rendered text.

## Notifications and email

- `host.sendNotification(message: Message)` replaces the string form.
- Admission stores the message, and the input digest covers the message, so deduplication does not
  depend on locale.
- The delivery job renders each notification in the recipient's interface locale, outside
  transactions, as rendering already is. Subjects and titles come from kernel templates.
- Signal properties that drive copy, such as `oldStatus` and `newStatus`, are codes.
- **Follow-up:** an entity-reference parameter that renders the entity's title through the
  localization module in the recipient's content language.
- User-authored text, such as reminder messages, is passed through unchanged.

## Preferences

`preferences.language` splits into:

- `interfaceLocale`: a BCP 47 tag limited to locales with shipped kernel catalogs. Null means the
  device or `Accept-Language` decides, which also applies before sign-in.
- `contentLanguage`: any ISO 639 language for entity translation (today's `language`). Null
  defaults to the interface locale's language.

## Client

- `kernel/client` mounts `I18nProvider`, loads locale catalogs lazily per namespace, and sets
  `lang` and `dir` on the document.
- The bridge lifecycle payload carries `locale`, `dir` and the plugin's catalogs, alongside
  `compact` and theme. `plugin-client-sdk` exposes `useMessages(catalog)`.
- Manifest `label`, `title` and `description` become message references.

## Unresolvable messages

Retained messages can outlive their catalog: a plugin can be uninstalled, or a later plugin version
can remove a key. This applies to notifications, submission outcomes and import outcomes.
Rendering then falls back to the kernel `message.unavailable` key. It does not fail, and it does
not keep stored English copies.

## Enforcement

- **Types:** contract errors, `sendNotification` and manifest text accept only messages.
- **Contract test:** walks `AppContract` error schemas and fails on any free-text field.
- **Catalog build checks:** in `ryot plugin build` and `bun run check`.
- **Lint:** bans literal JSX text, using oxlint's `react/jsx-no-literals` if available, otherwise a
  small repository check.
- **Pseudo-locale:** a generated pseudo-locale (via FormatJS) makes untranslated text visible in e2e
  runs. Regular e2e assertions run in English.
- **`AGENTS.md` rule, once implemented:** user-facing text crosses boundaries only as a message.

## Out of scope

- Model-facing text, such as agent tool descriptions, MCP schemas and assistant prompts, stays
  English. Assistant replies may follow the user's locale through a prompt hint.
- Logs, admin diagnostics and developer errors stay English.
- User-authored content (names, notes, reminder messages) is never translated. Provider content
  stays with the existing content-localization module.
- Locale-aware collation in RyotQL sorting.

## Rollout

1. Build `packages/i18n`, `packages/kernel-messages`, the catalog build step, and the preference
   split.
2. Convert errors to codes across contract, backend and client.
3. Add plugin catalogs: SDK, manifest message references, build validation, archives and the
   bridge.
4. Convert notifications and email to messages.
5. Move UI strings into catalogs across the kernel client, SDKs and plugin clients, and enable the
   lint rule and pseudo-locale.
6. Ship the first non-English locale.

## Sources

- [FormatJS: intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/),
  [advanced usage](https://formatjs.github.io/docs/guides/advanced-usage),
  [releases](https://github.com/formatjs/formatjs/releases)
- [TC39 Intl.MessageFormat proposal](https://github.com/tc39/proposal-intl-messageformat)
- [Locize: MessageFormat 2 in i18next, state of the migration](https://www.locize.com/blog/messageformat-2-i18next)
- [messageformat (MF2 implementation)](https://github.com/messageformat/messageformat)
- [next-intl precompilation and icu-minify](https://next-intl.dev/blog/precompilation)
- [Lingui: optimizing bundle size](https://lingui.js.org/guides/optimizing-bundle-size)
- [Paraglide JS](https://github.com/opral/paraglide-js)
