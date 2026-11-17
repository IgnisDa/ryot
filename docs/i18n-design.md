# Internationalization Design

Approved design, **2026-11-15**, against commit `9b0815e83a`. Rollout steps 1 to 4 are implemented.
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

| Source                         | Location                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP errors                    | `packages/contract/src/errors.ts`: `BadRequest`, `NotFound`, `Conflict`, `RateLimited`, `Unauthorized`, `InternalError`, `SubmissionExpired`, `TimeoutError` carry only `message: string`. About 240 helper calls and 31 direct constructions across the backend.                            |
| Validation and fallback errors | `kernel/backend/src/boot/server.ts` returns `String(defect.success.cause)` and `internalError(unknownToMessage(error))` to clients.                                                                                                                                                          |
| Notifications                  | Plugin automations, such as `plugins/media/backend/automations/notification.sandbox.ts`, build English sentences and call `host.sendNotification(string)`. Delivery adds an English subject (`` `${PROJECT_NAME} notification` ``).                                                          |
| Model-facing errors            | MCP and agent tools pass `error.message` to the model (`kernel/backend/src/modules/mcp/service.ts`, `kernel/backend/src/modules/agent-tools/`).                                                                                                                                              |
| UI                             | Inline JSX text in `kernel/client`, `packages/plugin-ui-sdk`, `packages/plugin-client-sdk`, `packages/kernel-renderers`, plugin clients and `packages/email-templates`. A trial run of `react/jsx-no-literals` reports about 2,000 occurrences. The client renders `error.message` directly. |
| Formatting                     | 82 direct `toLocale*String` and `Intl` formatter calls in client code, plus `REPORTING_LOCALE = "en-US"` in `packages/plugin-ui-sdk/src/metric-format.ts`. Analytics fixes the week start to Monday (`weekStartsOn: 1`) in `packages/contract/src/modules/analytics/`.                       |
| Native shell                   | iOS `Info.plist` display names, Android `strings.xml`, and literal SwiftUI text in `kernel/client/ios/App/RyotLiveActivities/`.                                                                                                                                                              |

`SandboxBoundaryReason` (`packages/contract/src/modules/scripts/boundary-reason.ts`) already
returns codes instead of sentences. This design applies that pattern everywhere.

## Model

User-facing text crosses every boundary (HTTP, iframe bridge, sandbox host calls, the database)
as a **message**, never as a rendered string:

```text
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

Shipped. See the [`packages/i18n` README](../packages/i18n/README.md) for the message model,
runtime engine, locale utilities and catalog compiler, and the
[`packages/kernel-messages` README](../packages/kernel-messages/README.md) for the kernel catalogs.
Kernel catalogs hold error reasons and the notification and email templates; validation issue copy
and the `plugin-ui-sdk` component copy move there as later steps convert them. Kernel sandbox
scripts compile as a package whose catalog is the kernel catalog, so they use the generated
`catalogMessage` builder like plugin scripts; see
[Build And Execution](../kernel/backend/src/modules/scripts/README.md#build-and-execution).

## Engine

Shipped. See [Rendering](../packages/i18n/README.md#rendering) and
[Engine choice](../packages/i18n/README.md#engine-choice).

## Catalogs and build

Shipped. The source format, validation, limits, markup rejection, reference checks and type
generation are described in the [catalog compiler](../packages/i18n/README.md#catalog-compiler)
section. Plugin catalogs live in `shared/messages/<locale>.json` by convention, without a manifest
declaration; see [Messages](../packages/plugin-kit/README.md#messages) for authoring, the
[CLI README](../packages/cli/README.md) for `ryot plugin messages` and `ryot plugin build`, the
[archive format](../packages/plugin-archive/README.md#format) for compiled catalogs in archives,
and the [backend plugins README](../kernel/backend/src/modules/plugins/README.md) for installation
checks, storage and serving. Remaining:

- **Translation workflow:** contributors edit locale JSON files through pull requests. CI runs the
  checks above, so reviewers judge only wording. No translation-management platform is used. The
  files use a standard layout, so one can be added later without changes.

## Errors

- Contract error classes remove `message: string` and carry `reason: Message`. They exist only to
  select HTTP status. They share one field set, `contractErrorFields`, in `contract`, and helpers
  such as `badRequest` accept only messages.
- `decodeErrorsAsBadRequest` returns `error.validation.invalid` with structured `{ path, issue }`
  entries derived from Effect Schema issues. The router fallback returns `error.internal.unexpected`.
  Diagnostics go only to logs and spans.
- `SandboxBoundaryReason` moves into the message model.
- Shipped: `OperationRejectedError` carries `reason: LocalMessage` from the plugin's own catalog,
  and the kernel stamps the run's plugin namespace; see
  [Messages](../packages/plugin-kit/README.md#messages).
- Internal tagged errors that never cross a boundary stay as they are.
- The client renders every error through one `formatError`. Background-submission state stores the
  message, not rendered text.
- Model-facing boundaries (MCP tool results and agent tool failures) render messages in English
  through one shared `packages/i18n` function over the same registry.

## Notifications and email

Shipped. See [Messages](../kernel/backend/src/modules/notifications/README.md#messages) in the
notifications README for admission, rendering and email, and
[Messages](../packages/plugin-kit/README.md#messages) for authoring notification and policy
rejection messages. A reminder's due time is a zoned date-time argument, so it renders in the
reminder's own time zone; see [Rendering](../packages/i18n/README.md#rendering). Remaining:

- **Follow-up:** an entity-reference parameter that renders the entity's title through the
  localization module in the recipient's content language.

## Preferences

Shipped. `packages/contract/src/schema/user-preferences.ts` defines `interfaceLocale`,
`contentLanguage` and `weekStart` with `resolveWeekStart` and
`resolveInterfaceLocale` (backend rendering of an unset locale uses the source locale); see the
[`packages/kernel-messages` README](../packages/kernel-messages/README.md) for the allowed
interface locales.

## Client

- Shipped: `kernel/client` mounts `I18nProvider` (`kernel/client/src/modules/i18n/`), loads the
  kernel locale catalogs lazily, and sets `lang` and `dir` on the document; see
  [Interface Language](../kernel/client/README.md#interface-language) for negotiation, first-paint
  gating, `message.loading` and `formatError`.
- Shipped: `kernel/client` also loads the listed plugins' catalogs per locale. The bridge lifecycle
  payload carries `locale`, `dir` and the host's catalogs, alongside `compact` and theme, and
  `plugin-client-sdk` exposes `useMessages(packageId, catalogMessage)`; see the
  [`plugin-client-sdk` README](../packages/plugin-client-sdk/README.md).
- Shipped: every display field defined in the plugin manifest uses `ManifestText`, and text a user
  can rename is `DisplayText`; see
  [Display text](../packages/contract/README.md#display-text).
- Shipped: browse field, choice and sort labels and the table column labels of kernel-rendered
  saved views are `ManifestText` in manifests and `DisplayText` (stamped messages) in the shared
  shapes users also author. Calendar captions are row text: a message whose arguments bind to
  query output fields, so queries yield codes and numbers; see
  [Display text](../packages/contract/README.md#display-text) and
  [Calendar Sources](../packages/plugin-kit/README.md#calendar-sources).
- Shipped: the kernel client's notification channel field labels and help text are kernel messages,
  rendered into the channel's `AppSchema` at the edge.
- Shipped: AppSchema `label` is display text and a new optional `hint` carries the user-facing help
  that forms render, while `description` stays English documentation for models and developers.
  Plugin schemas author `ManifestText` (kernel-provided building blocks author kernel messages),
  stamped where definitions, user settings, configuration, import inputs and search options
  resolve, and checked by `ryot plugin build` and installation. Model-facing JSON Schema renders
  labels through `formatForModel`. RyotQL parameter labels are `DisplayText` in the shared document
  shape, and kernel recipes author kernel messages. Documents authored in plugin code
  (`PluginRyotQLDocument`) label parameters with manifest text: declared queries and saved-view data
  sources are checked like other manifest text and stamped where definitions resolve them, and
  inline documents are stamped where they enter, by the sandbox host with the run's plugin and by
  the kernel client bridge with the requesting document's plugin. See
  [Display text](../packages/contract/README.md#display-text) and
  [Property Schemas](../packages/plugin-kit/README.md#property-schemas).
- Shipped: AppSchema region choices (`kind: "region"`) carry only a region code. Forms name them
  with the active locale's `displayNames` formatter and sort them by that name, so plugins ship no
  country names in their catalogs.
- Shipped: plugin clients render a curated set of kernel `common.*` messages (generic actions,
  statuses and yes/no) through `useMessages`, instead of copying them into plugin catalogs; see the
  [`plugin-client-sdk` README](../packages/plugin-client-sdk/README.md#messages-and-locale).
- Decision: kernel renderer documents receive every installed plugin's catalog, as a deliberate
  exception to per-plugin catalog isolation. They are kernel-shipped code that renders any plugin's
  labels, and catalogs are not secret.
- `t()` returns the branded `Text` type (shipped). SDK component text props accept only that type,
  so a plain string fails to compile.

## Native shell

Shipped. See [Native Text](../kernel/client/README.md#native-text) in the `kernel/client` README.

## Unresolvable messages

Retained messages can outlive their catalog: a plugin can be uninstalled, or a later plugin version
can remove a key. This applies to notifications, submission outcomes and import outcomes.
Rendering then falls back to the kernel `message.unavailable` key. It does not fail, and it does
not keep stored English copies. A catalog that is still loading is not unavailable: `kernel/client`
paints the authenticated shell only after the interface locale preference has settled and its
kernel and plugin catalogs first load. Afterwards, while plugin catalogs load or retry, missing
plugin messages render the neutral `message.loading` key, both in the shell and in plugin
documents, which receive the namespaces still loading as `pendingNamespaces` on the bridge.

## Enforcement

| Check                                                                          | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free text in contract errors, notifications, manifests and model-facing errors | **Types.** Contract error fields, `sendNotification(message: LocalMessage)`, policy rejection reasons and the manifest-text schema accept only messages. Removing `message` from errors breaks every call site that reads it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Plain strings in SDK components                                                | **Types, last.** Text props will accept only the branded type returned by `t()`. The props stay `string` until the consumer batches land, because making the change first breaks about 1,300 call sites. JSX children are covered by the lint.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Errors declared outside `contractErrorFields`                                  | **Contract test** in `packages/contract`: walks `AppContract` error schemas and fails on any free-text field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Plugin catalogs                                                                | **`ryot plugin messages` and `ryot plugin build`**, using the shared validator; the build also checks manifest text keys. Installation repeats the limit and manifest key checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Kernel catalogs                                                                | **`packages/kernel-messages` `build` script**, which Turbo runs before `check`, using the same validator. oxlint checks single JS/TS files and cannot compare JSON catalogs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Literal JSX text                                                               | **oxlint `react/jsx-no-literals`** (built in): `noStrings: true`, `ignoreProps: true`, and `restrictedAttributes` for text-bearing attributes (`aria-label`, `title`, `placeholder`, `alt`, `label`, `description`, `hint`). `ignoreProps` is required, otherwise every string attribute, such as `className`, is reported. Scoped through one `overrides` entry whose `files` list grows as each area converts. Today that is `plugin-ui-sdk`, `plugin-client-sdk` and `kernel-renderers`. `kernel/client`, `plugins/*/client` and the delivered email templates are next. Tests are excluded through `excludeFiles`. `allowedStrings` lists only non-linguistic tokens: space, `·`, `—`, `–`, `★` and `≥`. |
| Ad-hoc formatting                                                              | **oxlint `no-restricted-properties`** (built in): bans `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`, and `Intl.DateTimeFormat`, `NumberFormat`, `RelativeTimeFormat`, `ListFormat`, `PluralRules` and `DisplayNames`. Enabled everywhere. Overrides disable the formatting entries in three places: `packages/i18n`; `apps/website`, which is English-only marketing content; and `e2e/src/browser`, through `e2e/.oxlintrc.json`, because Playwright `page.evaluate` callbacks run in the browser and cannot import formatters. `Intl.Segmenter`, `Intl.supportedValuesOf` and `Intl.Locale` remain allowed. Effect `DateTime.format*` calls with fixed locales are not caught.             |
| Text outside JSX passed to third-party components                              | **Pseudo-locale** (shipped): the `en-XA` pseudo-locale generated by `packages/i18n` makes untranslated text visible in e2e runs; see [Pseudo-locale](../e2e/README.md#pseudo-locale) in the e2e README. Regular e2e assertions run in English.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Native text                                                                    | Xcode and Android Lint. Not part of `bun run check`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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
   plugin clients and email templates, including the display text nested in shared schemas. Enable
   both lint rules per area as it is converted, then the pseudo-locale.
   - Done:
     - The UI SDK, client SDK and kernel renderers render only catalog messages, under
       `react/jsx-no-literals`.
     - Formatting goes through the active locale's formatters everywhere. `REPORTING_LOCALE` is
       gone.
     - Filter, sort and choice labels, table column labels and text cells are `DisplayText`.
       Kernel recipes author them as kernel messages.
     - Collection member types group by the stable owner and schema key, and show the schema's
       served name.
     - Browse field, choice and sort labels and saved-view table column labels are manifest text,
       stamped where definitions resolve them and checked by `ryot plugin build` and installation.
     - Calendar captions are row text (`catalogRowText`), whose message declares exactly the bound
       arguments.
     - Notification channel field labels in the kernel client are kernel messages.
     - AppSchema labels and hints are display text, authored as manifest text and stamped where
       definitions and settings resolve; `description` stays model-facing English.
     - Plugin RyotQL parameter labels are manifest text, stamped for declared and inline documents.
     - Plugin documents receive only the kernel catalog and their contributors' catalogs; kernel
       renderer documents receive every installed plugin's catalog.
     - The `en-XA` pseudo-locale browser test walks key kernel and plugin screens; see
       [Pseudo-locale](../e2e/README.md#pseudo-locale) in the e2e README.
     - The `kernel/client` and plugin clients render only catalog messages, and SDK display props
       take `Text`.
6. Move native text into platform localization files and ship the first non-English locale.
   - Done: native text, including Android notification channel names; see the
     [`kernel/client` README](../kernel/client/README.md#native-text).
   - Done: German (`de`) for the kernel, the media, fitness and fixture plugins, and the iOS Live
     Activities text. It was drafted without a native speaker and awaits native-speaker review; the
     String Catalog entries are marked `needs_review`.

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
