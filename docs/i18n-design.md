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
| Manifests | Display fields in `packages/contract/src/modules/plugins/manifest.ts` are plain strings: `label`, `title` and `description`, and the `name` of plugins, entity schemas, events, signals, saved views and calendar sources. Shipped defaults such as saved view names ("All People") are English. |
| Model-facing errors | MCP and agent tools pass `error.message` to the model (`kernel/backend/src/modules/mcp/service.ts`, `kernel/backend/src/modules/agent-tools/`). |
| UI | Inline JSX text in `kernel/client`, `packages/plugin-ui-sdk`, `packages/plugin-client-sdk`, `packages/kernel-renderers`, plugin clients and `packages/email-templates`. A trial run of `react/jsx-no-literals` reports about 2,000 occurrences. The client renders `error.message` directly. |
| Formatting | 82 direct `toLocale*String` and `Intl` formatter calls in client code, plus `REPORTING_LOCALE = "en-US"` in `packages/plugin-ui-sdk/src/metric-format.ts`. Analytics fixes the week start to Monday (`weekStartsOn: 1`) in `packages/contract/src/modules/analytics/`. |
| Native shell | iOS `Info.plist` display names, Android `strings.xml`, and literal SwiftUI text in `kernel/client/ios/App/RyotLiveActivities/`. |

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
- **Limits:** plugin catalogs are untrusted input that the backend renders during delivery. The
  shared validator caps file size, key count, message length, ICU nesting depth, and plural and
  select branch counts. `ryot plugin build` applies the caps, and installation applies them again
  instead of trusting the archive.
- **No markup:** ICU tags are rejected. Parameters always render as plain text, and email delivery
  escapes rendered text for HTML.
- **Archives** carry the compiled catalogs. The backend stores them with the installation and
  serves them to the client.
- **Translation workflow:** contributors edit locale JSON files through pull requests. CI runs the
  checks above, so reviewers judge only wording. No translation-management platform is used. The
  files use a standard layout, so one can be added later without changes.

## Errors

- Contract error classes remove `message: string` and carry `reason: Message`. They exist only to
  select HTTP status. One factory in `contract` defines them with that fixed field set, and helpers
  such as `badRequest` accept only messages.
- `decodeErrorsAsBadRequest` returns `validation.invalid` with structured `{ path, issue }` entries
  derived from Effect Schema issues. The router fallback returns `internal.unexpected`.
  Diagnostics go only to logs and spans.
- `SandboxBoundaryReason` moves into the message model.
- `OperationRejectedError` carries `reason: Message` from the plugin's own catalog, exposed through
  `plugin-backend-sdk`.
- Internal tagged errors that never cross a boundary stay as they are.
- The client renders every error through one `formatError`. Background-submission state stores the
  message, not rendered text.
- Model-facing boundaries (MCP tool results and agent tool failures) render messages in English
  through one shared `packages/i18n` function over the same registry.

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

A separate `weekStart` preference replaces the hardcoded Monday. Null derives it from the interface
locale through `Intl.Locale#getWeekInfo`. It changes analytics bucketing on the backend, not only
display.

## Client

- `kernel/client` mounts `I18nProvider`, loads locale catalogs lazily per namespace, and sets
  `lang` and `dir` on the document.
- The bridge lifecycle payload carries `locale`, `dir` and the plugin's catalogs, alongside
  `compact` and theme. `plugin-client-sdk` exposes `useMessages(catalog)`.
- Every manifest display field uses one manifest-text schema that accepts only message
  references.
- A shipped default name, such as a plugin saved view's, stays a message reference until the user
  renames it. The new name is then user-authored text.
- `t()` returns a branded text type built with Effect's `Brand.nominal`. SDK component text props
  accept only that type, so a plain string fails to compile.

## Native shell

Native text uses platform localization, edited through the same pull request workflow: Xcode
String Catalogs for `Info.plist` and SwiftUI text (SwiftUI `Text("…")` literals are already
localization keys), and `values-<locale>/strings.xml` on Android. Xcode and Android Lint's
`MissingTranslation` report gaps. Live Activity titles and metric labels arrive over the bridge
already rendered by the plugin iframe in the viewer's locale.

## Unresolvable messages

Retained messages can outlive their catalog: a plugin can be uninstalled, or a later plugin version
can remove a key. This applies to notifications, submission outcomes and import outcomes.
Rendering then falls back to the kernel `message.unavailable` key. It does not fail, and it does
not keep stored English copies.

## Enforcement

| Check | Mechanism |
| --- | --- |
| Free text in contract errors, notifications, manifests and model-facing errors | **Types.** The error factory, `sendNotification(message: Message)` and the manifest-text schema accept only messages. Removing `message` from errors breaks every call site that reads it. |
| Plain strings in SDK components | **Types.** Text props accept only the branded type returned by `t()`. |
| Errors declared outside the factory | **Contract test** in `packages/contract`: walks `AppContract` error schemas and fails on any free-text field. |
| Plugin catalogs | **`ryot plugin build`**, using the shared validator. Installation repeats the limit checks. |
| Kernel catalogs | **`packages/kernel-messages` `check` script** running the same validator. oxlint checks single JS/TS files and cannot compare JSON catalogs. |
| Literal JSX text | **oxlint `react/jsx-no-literals`** (built in): `noStrings: true`, `ignoreProps: true`, and `restrictedAttributes` for text-bearing attributes (`aria-label`, `title`, `placeholder`, `alt`, `label`, `description`, `hint`). `ignoreProps` is required, otherwise every string attribute, such as `className`, is reported. Scoped through `overrides` to `kernel/client`, `plugin-ui-sdk`, `plugin-client-sdk`, `kernel-renderers`, `plugins/*/client` and the email templates the backend delivers, excluding tests. |
| Ad-hoc formatting | **oxlint `no-restricted-properties`** (built in): bans `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`, and `Intl.DateTimeFormat`, `NumberFormat`, `RelativeTimeFormat`, `ListFormat`, `PluralRules` and `DisplayNames`. An override disables it in `packages/i18n`. `Intl.Segmenter`, `Intl.supportedValuesOf` and `Intl.Locale` remain allowed. |
| Text outside JSX passed to third-party components | **Pseudo-locale:** a generated pseudo-locale (via FormatJS) makes untranslated text visible in e2e runs. Regular e2e assertions run in English. |
| Native text | Xcode and Android Lint. Not part of `bun run check`. |

No custom oxlint rule is needed. If one becomes necessary, it belongs in `ci/oxlint/ryot-plugin.mjs`
with tests in `ci/oxlint/ryot-plugin.test.mjs`.

The **`AGENTS.md` rule, once implemented:** user-facing text crosses boundaries only as a message.

## Out of scope

- Model-facing text, such as agent tool descriptions, MCP schemas and assistant prompts, stays
  English. Messages sent to the model render in English (see [Errors](#errors)). Assistant replies
  may follow the user's locale through a prompt hint.
- Logs, admin diagnostics and developer errors stay English.
- User-authored content (names, notes, reminder messages) is never translated. Provider content
  stays with the existing content-localization module.
- Locale-aware collation in RyotQL sorting.

## Rollout

1. Build `packages/i18n`, `packages/kernel-messages`, the catalog build step, and the preference
   split with `weekStart`. Add both packages to the root `AGENTS.md` ownership table.
2. Convert errors to codes across contract, backend and client, including the model-facing
   renderer. Add the `AGENTS.md` rule.
3. Add plugin catalogs: SDK, manifest message references, build validation, archives and the
   bridge.
4. Convert notifications and email to messages.
5. Move UI strings and formatting into `packages/i18n` across the kernel client, SDKs, renderers,
   plugin clients and email templates. Enable both lint rules per area as it is converted, then
   the pseudo-locale.
6. Move native text into platform localization files and ship the first non-English locale.

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
