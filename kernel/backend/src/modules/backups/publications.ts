import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { DefinitionSnapshot } from "@ryot-app/definitions/snapshot";
import { kernelPublicationPage } from "@ryot-app/ryotql-recipes/publication-browse";
import { Effect, Schema } from "effect";

import { managedAssetLocatorKey } from "#lib/domain/managed-asset-locators";
import { managedAssetLocators } from "#modules/assets/storage/locators";

import { archiveError } from "./archive/error";
import { type ArchivePublication, isArchiveJsonObject } from "./archive/schemas";
import { savedArgumentSources } from "./saved-arguments";

export const kernelPublicationDocument = (
	definitions: DefinitionSnapshot,
): null | RyotQLDocument => {
	const [first, ...rest] = Object.values(definitions.entitySchemas).map((schema) => ({
		browse: null,
		sortTypes: {},
		slug: schema.slug,
		presentationFields: [],
		pluginId: schema.pluginId,
	}));
	if (!first) {
		return null;
	}
	const document = kernelPublicationPage({ schemas: [first, ...rest] }).document;
	return { queries: {}, ...(document.parameters ? { parameters: document.parameters } : {}) };
};

export const publicationArguments = (publication: ArchivePublication) =>
	Effect.forEach(
		[
			publication.definition.arguments,
			...(publication.snapshot ? [publication.snapshot.arguments] : []),
		],
		(values) => savedArgumentSources(publication.document, values, true),
	);

export const rewritePublicationAssets = Effect.fn(function* (
	value: unknown,
	locators: ReadonlyMap<string, AssetLocator>,
) {
	const replacements = new Map<string, AssetLocator>();
	for (const locator of managedAssetLocators(value)) {
		const key = managedAssetLocatorKey(locator);
		const replacement = locators.get(key);
		if (!replacement) {
			return yield* archiveError(
				"missing_reference_mapping",
				"Publication asset mapping is incomplete",
			);
		}
		replacements.set(key, replacement);
	}
	const rewrite = (child: JsonValue): JsonValue => {
		if (Array.isArray(child)) {
			return child.map(rewrite);
		}
		if (!isArchiveJsonObject(child)) {
			return child;
		}
		if (typeof child["type"] === "string" && typeof child["key"] === "string") {
			const replacement = replacements.get(`${child["type"]}:${child["key"]}`);
			if (replacement) {
				return replacement;
			}
		}
		return Object.fromEntries(Object.entries(child).map(([key, nested]) => [key, rewrite(nested)]));
	};
	const decoded = yield* Schema.decodeUnknownEffect(JsonValue)(value).pipe(
		Effect.mapError((error) => archiveError("invalid_entry", error.message)),
	);
	return rewrite(decoded);
});
