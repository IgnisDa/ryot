import { expect, it } from "@effect/vitest";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";

import { validateRestoredProperties } from "./config-revisions";

const schema = {
	unknownKeys: "strict",
	fields: {
		region: {
			type: "string",
			label: "Region",
			description: "Region",
			validation: { required: true },
		},
		token: {
			secret: true,
			type: "string",
			label: "Token",
			description: "Token",
			validation: { required: true },
		},
	},
} satisfies AppSchema;

it.effect("allows only missing required secrets for needs-configuration restores", () =>
	Effect.gen(function* () {
		expect(yield* validateRestoredProperties({ region: "local" }, schema, [], true)).toEqual({
			needsConfiguration: true,
			properties: { region: "local" },
		});
		yield* validateRestoredProperties({}, schema, [], true).pipe(
			Effect.flip,
			Effect.tap((error) =>
				Effect.sync(() =>
					expect(error.message).toBe(
						"Plugin configuration does not match the selected package revision",
					),
				),
			),
		);
		yield* validateRestoredProperties({ region: "local" }, schema, [], false).pipe(
			Effect.flip,
			Effect.tap((error) =>
				Effect.sync(() =>
					expect(error.message).toBe(
						"Plugin configuration does not match the selected package revision",
					),
				),
			),
		);
	}),
);

it.effect("detects invalid redacted secret-array cardinality across backup generations", () => {
	const arraySchema = {
		unknownKeys: "strict",
		fields: {
			tokens: {
				type: "array",
				label: "Tokens",
				description: "Tokens",
				validation: { minItems: 1 },
				items: { secret: true, type: "string", label: "Token", description: "Token" },
			},
		},
	} satisfies AppSchema;
	return Effect.gen(function* () {
		expect(
			yield* validateRestoredProperties({ tokens: [] }, arraySchema, ["/tokens/0"], false),
		).toEqual({ needsConfiguration: true, properties: { tokens: [] } });
		expect(yield* validateRestoredProperties({ tokens: [] }, arraySchema, [], true)).toEqual({
			needsConfiguration: true,
			properties: { tokens: [] },
		});
	});
});
