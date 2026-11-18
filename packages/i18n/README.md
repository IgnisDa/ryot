# I18n

`@ryot-app/i18n` is the environment-neutral message model, ICU runtime, locale utilities and
catalog compiler. It knows no product vocabulary: namespaces are opaque strings (`kernel` or a
plugin ID) and catalogs are data.

## Messages

User-facing text crosses boundaries as a `Message` (`/message`), never as a rendered string:

```ts
{ namespace: "kernel", key: "settings.preferences.week-start.default", params: { day: "Monday" } }
```

- Keys are at least two dot-separated segments of lowercase kebab-case words (`MESSAGE_KEY_PATTERN`,
  at most 128 characters). Argument names match `ARGUMENT_NAME_PATTERN`, so positional ICU
  arguments are rejected.
- `params` values are strings, finite numbers, `{ date: ISO }` instants, `{ date: ISO, timeZone }`
  zoned date-times (`ZonedDateTimeParam`, checked by `isZonedDateTimeParam`), or nested messages.
  Entity-aware delivery boundaries may also accept `{ entityId }` references: they resolve these to
  visible, localized entity names before formatting. Unresolved references render
  `message.unavailable`. A calendar date (a day without a time of day) is a `YYYY-MM-DD` string. The
  schemas are JSON-safe; select codes are plain strings. They admit at most `MAX_MESSAGE_ARGUMENTS`
  parameters per message and nest only to `MAX_MESSAGE_NESTING_DEPTH`: nested message schemas are
  built to that depth, so decoding untrusted input never recurses further.
- A `LocalMessage` has no namespace. Code that runs under a plugin's authority produces local
  messages, and the trusted side stamps the namespace with `stampNamespace`, including nested
  messages, so a plugin cannot reference another catalog. Trusted producers, such as kernel
  scripts, submit a `TrustedLocalMessage`, whose nested messages may already be stamped, such as a
  plugin's definition name; `stampTrustedNamespace` keeps those namespaces. Plugin input always
  decodes as `LocalMessage`. `isMessage` tests for a message, `isNestedMessage` tells a nested
  message parameter from other values, and `messageNamespaces(message)` lists the namespaces a
  message and its nested messages use.
- Namespaces are `kernel` or a plugin ID (generated alphanumeric identifiers).
- `DisplayText` is a message or user-authored text. Text that ships as a message but that a user
  can rename, such as a saved view name, uses it; `formatDisplayText(t, text)` (`/format`) passes
  user text through unchanged.
- `messageBuilder<Catalog>(namespace)` (whose result also exposes its `namespace`) and
  `localMessageBuilder<Catalog>()` (`/builder`) type keys and
  parameters from a generated catalog type. `LocalTextBuilder<Catalog>` is the same signature
  returning rendered `Text`, for client hooks that stamp and render local messages. Parameters are
  required exactly when the key has arguments; select arguments accept only their declared codes;
  `Date` values are encoded as `{ date }`; calendar-date arguments take a `CalendarDate`
  (`YYYY-MM-DD`, checked by `isCalendarDate`) and stay plain strings on the wire; zoned date-time
  arguments take a `ZonedDateTime` (`{ date: Date, timeZone }`, an IANA zone) and are encoded as
  `{ date, timeZone }`. Generated catalog types use `NoArguments` for keys without
  arguments. `SelectCodes<Catalog, Key, Argument>` is the code union of a select argument, for code
  that passes those codes around.
- `localBindingBuilder<Catalog>()` (`/builder`) returns `{ text: { key }, params }` whose `params`
  name a value source for exactly the key's arguments (`ArgumentBindings`), for text whose values are
  bound later, such as per query row.

## Rendering

- `/catalog` holds the compiled catalog schema and the immutable `CatalogRegistry`
  (namespace → locale → catalog) with `registerCatalog`, or `catalogRegistry(entries, registry?)` for
  many `{ namespace, locale, catalog }` entries. `NamespaceCatalog` is the `{ namespace, catalog }`
  schema. `decodeCompiledCatalog(input, file?)` decodes an untrusted catalog and applies
  `compiledCatalogIssues`. Compiled catalogs are pre-parsed ICU ASTs in
  a closed JSON shape; number and date skeletons are stored as validated option objects.
- `format(registry, locale, message, options?)` (`/format`) walks the fallback chain
  (`pt-BR → pt → en`) inside the message's namespace, formats with `intl-messageformat` over the
  pre-parsed AST, and returns branded `Text` (`/text`). Plural categories follow the locale of the
  catalog the message resolved from, so an English fallback keeps English plural branches, while
  numbers and dates format in the requested locale. `options.timeZone` sets the IANA zone of date
  and time arguments, such as a notification recipient's; without it the runtime's zone applies.
  Calendar-date arguments always render in UTC, so a day reads the same in every zone; a value that
  is not a valid `YYYY-MM-DD` day renders `message.unavailable`. Zoned date-time arguments render in
  the zone their value carries, whatever `options.timeZone` is; a value that is not a zoned
  date-time or names a zone the runtime does not know renders `message.unavailable`. Missing catalogs, keys, parameters or formatting failures render
  the kernel `message.unavailable` key instead of failing; only a registry without the kernel
  catalog throws. An optional `options.isPending(namespace)` predicate marks catalogs that are still
  loading; a message that fails while it uses one renders the neutral `message.loading` key
  instead. `I18nProvider` accepts the same predicate. `IntlMessageFormat` instances are cached per compiled message, requested and catalog
  locale, time zone, and the zones of its zoned date-time arguments.
- `formatForModel(registry, message)` renders in `SOURCE_LOCALE` for model-facing boundaries (MCP
  tool results, agent tool failures), whatever the user's interface locale.
- `/formatters` caches `Intl` number, date-time, relative-time, list, plural and display-name
  formatters per locale and options. `formattersFor(locale)` returns them bound to one locale. A
  cached date-time formatter keeps the time zone it was created in, so zone-sensitive callers pass
  `timeZone`. `systemTimeZone()` reads the runtime's current zone uncached. This package is the
  only code that constructs `Intl` formatters or calls `toLocale*String`. A lint rule enforces
  this.
- `formatRich(registry, locale, message, rich, options?)` (`/format`) renders like `format`, with `rich`
  supplying argument values that are not text; it returns the literal text and those values as
  separate parts.
- `/react` provides `I18nProvider({ locale, registry, isPending? })`, `useT()`, `useLocale()`,
  `useTextDirection()`, `useFormatters()` and `useRichText(builder)`.
- Catalogs never contain markup. Emphasis and other markup around user data comes from
  `useRichText`, whose `RichTextBuilder` accepts a React element for any text argument, keyed by
  argument name so reordering translations keeps element identity. Number, date and select
  arguments stay plain values:

  ```tsx
  const richText = useRichText(kernelMessage);
  richText("client.route.oauth-consent.return-origin", { origin: <strong>{origin}</strong> });
  ```

The runtime never parses ICU source. Browser bundles alias `@formatjs/icu-messageformat-parser` to
`@formatjs/icu-messageformat-parser/no-parser.js`, which keeps only the enums `intl-messageformat`
needs (see `kernel/client/vite.config.ts`).

### Engine choice

Messages use ICU MessageFormat 1 with native `Intl.PluralRules`. Catalogs ship as data, never as executable code. Plugin catalogs come from untrusted archives and
are rendered by trusted kernel code, so compiler-to-function tools are excluded.

| Alternative                          | Decision                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Paraglide                            | Rejected: it compiles messages to JavaScript functions, so plugin catalogs would be executable code.                      |
| Lingui                               | Rejected: it centres on extracting messages from source code; runtime compilation is stripped from production by default. |
| i18next + ICU plugin                 | Rejected: ICU sits on top of its own format, and its namespace and loading system duplicates `packages/i18n`.             |
| react-intl                           | Unnecessary: `useT()` over `intl-messageformat` covers both the kernel client and plugin iframes.                         |
| `messageformat` v4 (MessageFormat 2) | Deferred: `Intl.MessageFormat` is at TC39 Stage 1, and translation-tool support is minimal.                               |
| `icu-minify`                         | Watched: its data IR and small runtime fit the design, but it is experimental and lives in the next-intl monorepo.        |

All formatting goes through `packages/i18n`, so replacing the engine changes only the build step
and the formatter, not any call site.

## Locales

`/locale` exports `SOURCE_LOCALE` (`en`), `PSEUDO_LOCALE` (`en-XA`), `canonicalLocale`, the
`LocaleTag` schema (canonical BCP 47 tags), `fallbackChain`, `parseAcceptLanguage`, `negotiateLocale` (exact or truncated match with the same likely script, then the same
language and script, preferring the likely region; never the pseudo-locale by language), `textDirection` with its `TextDirection` schema,
`languageOfLocale`, and
`weekStartForLocale`. Week days are the `WeekDay` schema and type, in Effect's `weekStartsOn`
numbering (`0` is Sunday). The week
start comes from `Intl.Locale#getWeekInfo` when the runtime has it, otherwise from the bundled CLDR
first-day table, which `cldrWeekStart` exposes directly.

## Catalog compiler

The compiler modules under `/compiler/*` run at build time only and are shared by every catalog
build.

- **Source format:** one JSON object per locale, `messages/<locale>.json`. Each entry is an ICU
  MessageFormat string or `{ "message": string, "description"?: string }`. English is the source
  locale; descriptions are read from English only.
- `validateCatalogSources(files)` (`/compiler/validate`) parses every file and returns the compiled
  catalogs, descriptions, argument kinds from English, and diagnostics. Errors: invalid JSON,
  locale tags that are not canonical or are the pseudo-locale, invalid keys or entries, ICU syntax
  errors, markup tags, styles outside the supported set, plural or select arguments without an
  `other` branch, select arguments with no code besides `other`, argument kinds that conflict within a
  message, a missing English file, keys absent from English, and argument names or kinds (including
  select codes) that differ from English. A key missing from a translation is a warning.
- **Limits** (`CATALOG_LIMITS`): 512 KiB per file, 5,000 keys, 2,000 characters per message, 500 per
  description, ICU nesting depth 3, 16 plural or select branches, and 16 arguments per message.
  `compiledCatalogIssues(catalog)` (`/catalog`) repeats the structural limits on compiled catalogs
  so installation can recheck untrusted archives without the parser.
- **Supported styles:** `number` with `integer`, `percent` or a number skeleton; `date` and `time`
  with `short`, `medium`, `long`, `full` or a date skeleton. A `date` argument with
  `calendar-short`, `calendar-medium`, `calendar-long` or `calendar-full` is a calendar date: it
  compiles to the matching named date options plus `timeZone: "UTC"`, its argument kind is
  `calendar-date` (generated as `CalendarDateArgument`), and translations must keep a calendar
  style. A `date` or `time` argument with `zoned-short`, `zoned-medium`, `zoned-long` or
  `zoned-full` is a zoned date-time: it compiles to the options of the matching named date or time
  style plus `timeZone: ARGUMENT_TIME_ZONE`, which rendering replaces with the value's zone; its
  argument kind is `zoned-date-time` (generated as `ZonedDateTimeArgument`), every use of the
  argument in a message must be zoned, and translations must keep zoned styles. Compiled catalogs
  accept `timeZone` only as `UTC` on date arguments without time fields, or as
  `ARGUMENT_TIME_ZONE`. Currency and unit styles and skeletons are rejected, in sources and in compiled catalogs.
  Catalogs compile without a locale, so date skeletons accept only fields with a locale-independent
  `Intl.DateTimeFormat` mapping, each once: `G`, `y`/`yy`, `M`/`L`, `d`, `E`, `eeee`/`cccc` and
  their narrow forms, `m`, `s`, `z`, `h`/`H`/`K`/`k` (a fixed hour cycle) and `j` (an hour with
  no hour cycle, so the locale's preferred cycle applies when rendering). `J`, `C`, day periods and
  other fields are rejected.
- `scanMessageReferences({ keys, builders, files })` (`/compiler/references`) treats any quoted
  literal equal to a key as a use and reports builder calls whose first literal argument is not a
  key. `referenceDiagnostics` turns the scan into `unknown-key` and `unused-key` errors.
- `compileCatalogs({ root, directory })` (`/compiler/build`) reads and validates
  `<directory>/<locale>.json`, logs diagnostics, fails with `CatalogBuildError` on errors, and adds
  the pseudo-locale to the compiled catalogs.
- `checkCatalogReferences({ catalogPath, keys, builders, references })` (`/compiler/build`) checks
  caller-supplied source files against the source locale's keys. It logs diagnostics and fails with
  `CatalogBuildError` on unknown or unused keys.
- `pseudoLocalizeCatalog(catalog)` (`/compiler/pseudo`) accents and lengthens literal text and
  brackets each message, leaving arguments untouched, so untranslated text stands out.
- `generateCatalogModules(...)` (`/compiler/codegen`) emits a TypeScript index with the catalog type
  (JSDoc from descriptions), the locale tuple and type, and an Effect loader that imports each locale
  module lazily, plus JavaScript data modules and a shared declaration for their exports.
  `generateLocalBuilderModule(...)` emits only the
  catalog type and typed local message and binding builders, for catalogs that ship as data, such as
  plugin catalogs (`ryot plugin messages`).
- `formatCatalogDiagnostic` prints `file: key: severity code: detail`.
