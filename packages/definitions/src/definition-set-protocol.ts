import { Effect, Schema } from "effect";

import {
	type DefinitionSetChange,
	DefinitionSetPlugin,
	DefinitionSetScope,
	validateDefinitionSet,
} from "./definition-set";
import { DefinitionSource } from "./snapshot";

export const DefinitionSetValidationRequest = Schema.Struct({
	baseline: DefinitionSource,
	plugins: Schema.Array(DefinitionSetPlugin),
	change: Schema.optional(
		Schema.Struct({ scope: DefinitionSetScope, pluginIds: Schema.Array(Schema.String) }),
	),
});

export const DefinitionSetValidationResponse = Schema.Union([
	Schema.Struct({ valid: Schema.Literal(true) }),
	Schema.Struct({ issue: Schema.String, valid: Schema.Literal(false) }),
]);

const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeRequest = Schema.decodeUnknownEffect(
	Schema.fromJsonString(DefinitionSetValidationRequest),
);
const encodeResponse = Schema.encodeEffect(Schema.fromJsonString(DefinitionSetValidationResponse));

export const decodeDefinitionSetValidationResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(DefinitionSetValidationResponse),
);

/**
 * The inputs were decoded when they were stored and every field encodes as itself, so the parent
 * writes them as JSON: re-encoding large manifests through the schema would block its event loop.
 */
export const encodeDefinitionSetValidationRequest = (
	baseline: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
	change?: DefinitionSetChange,
) =>
	encodeRequest({
		baseline,
		plugins: plugins.map(({ id, scope, manifest }) =>
			scope === undefined ? { id, manifest } : { id, scope, manifest },
		),
		...(change === undefined ? {} : { change: { ...change, pluginIds: [...change.pluginIds] } }),
	} satisfies typeof DefinitionSetValidationRequest.Type);

/** Serves one request line; a request that does not decode is a protocol defect, not an invalid set. */
export const serveDefinitionSetValidation = (line: string) =>
	decodeRequest(line).pipe(
		Effect.orDie,
		Effect.flatMap(({ change, plugins, baseline }) =>
			Effect.try({
				catch: String,
				try: () =>
					validateDefinitionSet(
						baseline,
						plugins,
						change && { scope: change.scope, pluginIds: new Set(change.pluginIds) },
					),
			}),
		),
		Effect.match({
			onSuccess: (): typeof DefinitionSetValidationResponse.Type => ({ valid: true }),
			onFailure: (issue): typeof DefinitionSetValidationResponse.Type => ({ issue, valid: false }),
		}),
		Effect.flatMap(encodeResponse),
		Effect.orDie,
	);
