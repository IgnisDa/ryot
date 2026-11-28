import { expect } from "bun:test";

import { fixtureManifest } from "@ryot-app/contract/testing";
import { validateDefinitionSet } from "@ryot-app/definitions/definition-set";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import {
	decodeValidateDefinitionSetResponse,
	encodeValidateDefinitionSetRequest,
	servePluginValidationRequest,
} from "./validation-worker-protocol";

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

/** The request crosses the process boundary as one JSON line, and so does the answer. */
const serve = (plugins: Parameters<typeof encodeValidateDefinitionSetRequest>[1]) =>
	encodeValidateDefinitionSetRequest(kernelDefinitionSource(), plugins, {
		scope: "system",
		pluginIds: new Set(plugins.map(({ id }) => id)),
	}).pipe(
		Effect.flatMap(servePluginValidationRequest),
		Effect.flatMap(decodeValidateDefinitionSetResponse),
	);

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
