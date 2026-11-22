import { expect } from "bun:test";

import { fixtureManifest } from "@ryot-app/contract/testing";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Schema } from "effect";

import { validateDefinitionSet } from "./definition-set";
import {
	DefinitionSetValidationRequest,
	definitionSetValidationRequest,
	validateDefinitionSetRequest,
} from "./definition-set-protocol";
import { kernelDefinitionSource } from "./kernel-definitions";

const manifest = fixtureManifest();
const entitySchema = manifest.entitySchemas[0];
assert(entitySchema);
const invalidPlugin = {
	id: "invalid",
	manifest: {
		...manifest,
		entitySchemas: [{ ...entitySchema, mergeIdentityProperties: ["missing"] }],
	},
};

const RequestJson = Schema.fromJsonString(DefinitionSetValidationRequest);

/** The request crosses a process boundary as JSON of its decoded value. */
const serve = (plugins: Parameters<typeof definitionSetValidationRequest>[1]) =>
	Schema.decodeEffect(RequestJson)(
		JSON.stringify(
			definitionSetValidationRequest(kernelDefinitionSource(), plugins, {
				scope: "system",
				pluginIds: new Set(plugins.map(({ id }) => id)),
			}),
		),
	).pipe(Effect.flatMap(validateDefinitionSetRequest));

layer(Layer.empty)((test) => {
	test.effect(
		"validates a definition set decoded from the JSON of its inputs",
		() =>
			Effect.gen(function* () {
				expect(yield* serve([{ manifest, id: "valid", scope: "system" }])).toEqual({ valid: true });
			}),
		testTimeout,
	);

	test.effect(
		"answers an invalid definition set with the error it throws in process",
		() =>
			Effect.gen(function* () {
				const thrown = yield* Effect.try({
					catch: String,
					try: () => validateDefinitionSet(kernelDefinitionSource(), [invalidPlugin]),
				}).pipe(Effect.flip);

				expect(thrown).toContain("merge identity property 'missing' is not defined");
				expect(yield* serve([invalidPlugin])).toEqual({ valid: false, issue: thrown });
			}),
		testTimeout,
	);
});
