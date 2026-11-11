import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import {
	decodeEntitySourceReference,
	encodeEntitySourceReference,
	type EntitySourceReference,
} from "@ryot-app/contract/modules/ryotql/entity-source";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Schema } from "effect";

import { archiveError, type BackupArchiveError } from "./archive/error";

export const savedArgumentSources = Effect.fn(function* (
	document: null | RyotQLDocument,
	values: Readonly<Record<string, JsonValue>>,
) {
	const valuesBound = yield* Effect.fromResult(bindArguments(document?.parameters, values)).pipe(
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
) {
	const { bound, sources } = yield* savedArgumentSources(document, values);
	const result = { ...bound };
	for (const { key, source } of sources) {
		result[key] = encodeEntitySourceReference(yield* rewrite(source));
	}
	return result;
});
