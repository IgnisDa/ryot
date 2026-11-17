import { validateCatalogSources } from "@ryot-app/i18n/compiler/validate";
import { SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import { Effect } from "effect";

import { CATALOG_MESSAGES_DIRECTORY } from "./messages-module";

/** The source-locale catalog of the plugin package at `packageRoot`, empty when it has none. */
export const compilePluginCatalog = Effect.fn("compilePluginCatalog")(function* (
	packageRoot: string,
) {
	const path = `${packageRoot}/${CATALOG_MESSAGES_DIRECTORY}/${SOURCE_LOCALE}.json`;
	const file = Bun.file(path);
	if (!(yield* Effect.promise(() => file.exists()))) {
		return {};
	}
	const content = yield* Effect.promise(() => file.text());
	const catalog = validateCatalogSources([{ path, content, locale: SOURCE_LOCALE }]).catalogs.get(
		SOURCE_LOCALE,
	);
	if (catalog === undefined) {
		return yield* Effect.die(new Error(`${path} does not compile`));
	}
	return catalog;
});
