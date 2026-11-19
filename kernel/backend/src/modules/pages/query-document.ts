import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { importQueryDocuments } from "@ryot-app/ryotql/imports";
import { Effect, Schema } from "effect";

import type { DefinitionCatalog } from "#modules/definitions/catalog";

class PageQueryDocumentError extends Schema.TaggedError<
	PageQueryDocumentError,
	{ readonly brand: unique symbol }
>()("PageQueryDocumentError", { message: Schema.String }) {}

export const pageQueryDocument = Effect.fn("pageQueryDocument")(function* (
	catalogs: DefinitionCatalog["Service"],
	userId: string,
	definition: PageDefinition,
) {
	const imports: Record<string, RyotQLDocument> = {};
	for (const [local, imported] of Object.entries(definition.pluginQueries ?? {})) {
		const reference = definition.pluginDependencies[imported.dependency];
		if (!reference) {
			return yield* new PageQueryDocumentError({
				message: `Plugin query '${local}' names undeclared dependency '${imported.dependency}'`,
			});
		}
		const declared = yield* catalogs.declaredQuery(userId, reference, imported.query);
		if (!declared) {
			return yield* new PageQueryDocumentError({
				message: `Plugin query '${local}' is unavailable: dependency '${imported.dependency}' declares no query '${imported.query}'`,
			});
		}
		imports[local] = declared.document;
	}
	return yield* Effect.fromResult(importQueryDocuments(definition.queries, imports)).pipe(
		Effect.mapError((error) => new PageQueryDocumentError({ message: error.message })),
	);
});
