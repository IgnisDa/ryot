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

export type DefinitionSetValidationRequest = typeof DefinitionSetValidationRequest.Type;

export const DefinitionSetValidationResponse = Schema.Union([
	Schema.Struct({ valid: Schema.Literal(true) }),
	Schema.Struct({ issue: Schema.String, valid: Schema.Literal(false) }),
]);

export type DefinitionSetValidationResponse = typeof DefinitionSetValidationResponse.Type;

/** Keeps only the fields validation reads, so callers can pass richer plugin records. */
export const definitionSetValidationRequest = (
	baseline: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
	change?: DefinitionSetChange,
): DefinitionSetValidationRequest => ({
	baseline,
	plugins: plugins.map(({ id, scope, manifest }) =>
		scope === undefined ? { id, manifest } : { id, scope, manifest },
	),
	...(change === undefined ? {} : { change: { ...change, pluginIds: [...change.pluginIds] } }),
});

/** Answers with the string of the error the in-process validator throws. */
export const validateDefinitionSetRequest = ({
	change,
	plugins,
	baseline,
}: DefinitionSetValidationRequest) =>
	Effect.try({
		catch: String,
		try: () =>
			validateDefinitionSet(
				baseline,
				plugins,
				change && { scope: change.scope, pluginIds: new Set(change.pluginIds) },
			),
	}).pipe(
		Effect.match({
			onSuccess: (): DefinitionSetValidationResponse => ({ valid: true }),
			onFailure: (issue): DefinitionSetValidationResponse => ({ issue, valid: false }),
		}),
	);
