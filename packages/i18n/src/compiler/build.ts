import { Effect, FileSystem, Path, Schema } from "effect";

import { PSEUDO_LOCALE, SOURCE_LOCALE } from "../locale";
import { pseudoLocalizeCatalog } from "./pseudo";
import {
	referenceDiagnostics,
	type ReferenceSourceFile,
	scanMessageReferences,
} from "./references";
import {
	catalogErrorCount,
	hasCatalogErrors,
	logCatalogDiagnostics,
	validateCatalogSources,
} from "./validate";

export class CatalogBuildError extends Schema.TaggedError<
	CatalogBuildError,
	{ readonly brand: unique symbol }
>()("CatalogBuildError", { errors: Schema.Int }) {}

/**
 * Validates `<directory>/<locale>.json` under `root`, logs every diagnostic and fails on errors,
 * including keys that `references` never use and builder calls naming unknown keys. The result adds
 * the pseudo-locale catalog. Diagnostic paths are relative to `root`.
 */
export const buildCatalogs = Effect.fn("buildCatalogs")(function* (input: {
	readonly root: string;
	readonly directory: string;
	readonly builders: ReadonlyArray<string>;
	readonly references: ReadonlyArray<ReferenceSourceFile>;
}) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const messagesRoot = path.join(input.root, input.directory);
	const catalogFiles = (yield* fs.exists(messagesRoot))
		? (yield* fs.readDirectory(messagesRoot)).filter((file) => file.endsWith(".json")).sort()
		: [];
	const validated = validateCatalogSources(
		yield* Effect.forEach(catalogFiles, (file) =>
			Effect.map(fs.readFileString(path.join(messagesRoot, file)), (content) => ({
				content,
				locale: file.slice(0, -".json".length),
				path: path.join(input.directory, file),
			})),
		),
	);
	const source = validated.catalogs.get(SOURCE_LOCALE);
	const keys = Object.keys(source ?? {});
	const diagnostics = [
		...validated.diagnostics,
		...referenceDiagnostics({
			keys,
			catalogPath: path.join(input.directory, `${SOURCE_LOCALE}.json`),
			scan: scanMessageReferences({
				keys: new Set(keys),
				files: input.references,
				builders: input.builders,
			}),
		}),
	];
	yield* logCatalogDiagnostics(diagnostics);
	if (source === undefined || hasCatalogErrors(diagnostics)) {
		return yield* new CatalogBuildError({ errors: catalogErrorCount(diagnostics) });
	}
	return {
		...validated,
		source,
		catalogs: new Map([...validated.catalogs, [PSEUDO_LOCALE, pseudoLocalizeCatalog(source)]]),
	};
});
