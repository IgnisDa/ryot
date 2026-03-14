import { expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";

import { builtinSignalSchemas } from "./signal-schemas";

const contracts = {
	"workout.created": { workoutId: "workout-1", workoutName: "Morning Run" },
	"integration.disabled": { integrationId: "integration-1", providerName: "komga" },
	"review.created": {
		entityName: "Dune",
		entityId: "entity-1",
		entitySchemaSlug: "book",
		reviewEventId: "review-1",
	},
} as const;

it.effect("defines strict active actor contracts for the first notification signals", () =>
	Effect.gen(function* () {
		const definitions = builtinSignalSchemas().filter(
			(
				definition,
			): definition is (typeof builtinSignalSchemas extends () => readonly (infer T)[]
				? T
				: never) & { slug: keyof typeof contracts } => definition.slug in contracts,
		);

		expect(definitions.map(({ slug }) => slug)).toEqual([
			"review.created",
			"workout.created",
			"integration.disabled",
		]);
		for (const definition of definitions) {
			expect(definition.catalogState).toBe("active");
			expect(definition.audiencePolicy).toEqual({ kind: "actor" });
			expect(definition.propertiesSchema.unknownKeys).toBe("strict");

			const valid = yield* parseAppSchemaProperties({
				kind: "Signal",
				properties: contracts[definition.slug],
				propertiesSchema: definition.propertiesSchema,
			});
			expect(valid).toEqual(contracts[definition.slug]);

			const unknown = yield* Effect.either(
				parseAppSchemaProperties({
					kind: "Signal",
					properties: { ...contracts[definition.slug], unexpected: true },
					propertiesSchema: definition.propertiesSchema,
				}),
			);
			expect(Either.isLeft(unknown)).toBe(true);
		}
	}),
);
