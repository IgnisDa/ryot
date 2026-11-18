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

export const compileCatalogs = Effect.fn("compileCatalogs")(function* (input: {
	readonly root: string;
	readonly directory: string;
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
	yield* logCatalogDiagnostics(validated.diagnostics);
	if (source === undefined || hasCatalogErrors(validated.diagnostics)) {
		return yield* new CatalogBuildError({ errors: catalogErrorCount(validated.diagnostics) });
	}
	return {
		...validated,
		source,
		catalogs: new Map([...validated.catalogs, [PSEUDO_LOCALE, pseudoLocalizeCatalog(source)]]),
	};
});

export const checkCatalogReferences = Effect.fn("checkCatalogReferences")(function* (input: {
	readonly catalogPath: string;
	readonly keys: ReadonlyArray<string>;
	readonly builders: ReadonlyArray<string>;
	readonly references: ReadonlyArray<ReferenceSourceFile>;
}) {
	const diagnostics = referenceDiagnostics({
		keys: input.keys,
		catalogPath: input.catalogPath,
		scan: scanMessageReferences({
			files: input.references,
			builders: input.builders,
			keys: new Set(input.keys),
		}),
	});
	yield* logCatalogDiagnostics(diagnostics);
	return yield* hasCatalogErrors(diagnostics)
		? Effect.fail(new CatalogBuildError({ errors: catalogErrorCount(diagnostics) }))
		: Effect.void;
});
