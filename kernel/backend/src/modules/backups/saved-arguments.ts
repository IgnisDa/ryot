import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import {
	decodeEntitySourceReference,
	encodeEntitySourceReference,
	type EntitySourceReference,
} from "@ryot-app/contract/modules/ryotql/entity-source";
import { bindArguments, bindPartialArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { EntityId, PluginId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Schema } from "effect";

import { archiveError, type BackupArchiveError } from "./archive/error";

export const savedArgumentSources = Effect.fn(function* (
	document: null | RyotQLDocument,
	values: Readonly<Record<string, JsonValue>>,
	partial = false,
) {
	const valuesBound = yield* Effect.fromResult(
		(partial ? bindPartialArguments : bindArguments)(document?.parameters, values),
	).pipe(
		Effect.mapError((error) =>
			archiveError("invalid_entry", error.map((issue) => issue.message).join("; ")),
		),
	);
	const bound = yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))(
		valuesBound,
	).pipe(Effect.mapError((error) => archiveError("invalid_entry", error.message)));
	const sources: { readonly key: string; readonly source: EntitySourceReference }[] = [];
	for (const [key, property] of Object.entries(document?.parameters?.fields ?? {})) {
		const value = bound[key];
		if (
			property.type !== "string" ||
			property.reference?.kind !== "entity-source" ||
			typeof value !== "string"
		) {
			continue;
		}
		const source = yield* Effect.fromResult(decodeEntitySourceReference(value)).pipe(
			Effect.mapError((error) => archiveError("invalid_entry", error.message)),
		);
		sources.push({ key, source });
	}
	return { bound, sources };
});

export const rewriteSavedArgumentSources = Effect.fn(function* (
	document: null | RyotQLDocument,
	values: Readonly<Record<string, JsonValue>>,
	rewrite: (
		source: EntitySourceReference,
	) => Effect.Effect<EntitySourceReference, BackupArchiveError>,
	partial = false,
) {
	const { bound, sources } = yield* savedArgumentSources(document, values, partial);
	const result = { ...bound };
	for (const { key, source } of sources) {
		result[key] = encodeEntitySourceReference(yield* rewrite(source));
	}
	return result;
});

export const importSavedArguments = (
	document: null | RyotQLDocument,
	values: Readonly<Record<string, JsonValue>>,
	plugins: ReadonlyMap<string, string>,
	entities: ReadonlyMap<string, string>,
	views: ReadonlyMap<string, string>,
	options: { readonly frozen?: boolean; readonly partial?: boolean } = {},
) =>
	rewriteSavedArgumentSources(
		document,
		values,
		Effect.fn(function* (source) {
			if (source.kind === "collection") {
				const id = entities.get(source.collectionId);
				if (id) {
					return { ...source, collectionId: EntityId.make(id) };
				}
			} else if (source.reference.kind === "kernel") {
				return source;
			} else if (source.reference.kind === "custom") {
				const id = views.get(source.reference.savedViewId);
				if (id) {
					return {
						...source,
						reference: { ...source.reference, savedViewId: SavedViewId.make(id) },
					};
				}
			} else {
				const id = plugins.get(source.reference.pluginId);
				if (id) {
					return { ...source, reference: { ...source.reference, pluginId: PluginId.make(id) } };
				}
			}
			if (options.frozen) {
				return source;
			}
			return yield* archiveError(
				"missing_reference_mapping",
				"Saved argument source mapping is incomplete",
			);
		}),
		options.partial ?? false,
	);
