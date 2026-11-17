# Kernel Messages

`@ryot-app/kernel-messages` owns the kernel's message catalogs. Copy stays product-agnostic.

- `messages/<locale>.json` are the sources, in the `@ryot-app/i18n` catalog format. English
  (`en.json`) is the source locale and contains only keys that code references.
- `bun run build` (`tooling/build-catalogs.ts`) runs `buildCatalogs` from `@ryot-app/i18n` over
  the sources and the reference roots listed in the script, which validates the sources, scans for
  `kernelMessage(...)` calls and key literals, and fails on any error diagnostic, including unknown
  and unused keys. It
  then generates `src/catalog.generated.ts` and `src/locales/<locale>.generated.ts`, adding the
  `en-XA` pseudo-locale. Generated files are git-ignored; Turbo runs `build` before `check` and
  `test` here and before dependents, and its inputs include every scanned root.
- `/catalog` exports `KernelCatalog`, `kernelLocales`, `KernelLocale` and
  `loadKernelCatalog(locale)`, which imports a locale module lazily. `/locales/<locale>` exports
  that locale's compiled `catalog`.
- `/message` exports `kernelMessage`, the typed builder for `kernel` namespace messages, and
  `kernelText`, the local builder for the manifest text of kernel definitions
  (`packages/definitions`), whose namespace is stamped where they are served:

  ```ts
  kernelMessage("settings.preferences.week-start.default", { day: "Monday" });
  ```

- `/testing` exports `testKernelRegistry`, `testKernelText` (renders a `Message` in English),
  `testFormatters` and `testText` (brands a literal as rendered `Text`) for kernel, SDK and plugin tests.

UI keys are prefixed by owner: `common.*` for generic words, `ui.*` for the UI SDK, `sdk.*` for the
client SDK, `renderer.*` for kernel renderers and `recipe.*` for kernel recipe display text.

Error reasons use `error.<area>.<problem>` keys, where `<area>` is the owning backend module or
contract concept (`error.storage.write-failed`, `error.validation.invalid`). One sentence has one
key; callers in other modules reuse it. Identifiers, paths and user text are string parameters,
counts and limits are `number` arguments, and enumerations are `select` codes, never English
fragments.

`kernelLocales` is the allowed list for the `interfaceLocale` preference. `en-XA` is accepted there
for testing but is not offered by the language picker.

The authored locales are English (`en`), German (`de`), French (`fr`), Spanish for Spain
(`es-ES`), Brazilian Portuguese (`pt-BR`), European Portuguese (`pt-PT`), and Simplified Chinese
(`zh-Hans`). Non-English translations are drafts awaiting native-speaker review. Add each locale's
catalog here and in the plugins that ship translated UI; the shared compiler, preference schema,
and language picker discover kernel locales from these files. Native resources follow the
[client's localization instructions](../../kernel/client/README.md#native-text).
