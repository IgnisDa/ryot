import { assert, expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect, Result } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { fixtureManifest, fixturePluginIdentity } from "#modules/plugins/test-support";

import { kernelDefinitionSource } from "./kernel-source";
import { buildDefinitionSnapshot } from "./snapshot";
import { mergeManifestDefinitions } from "./source";

const signalDefinitions = () => {
	const base = fixtureManifest();
	const plugin: { readonly id: string; readonly slug: string; readonly manifest: PluginManifest } =
		{
			...fixturePluginIdentity(),
			manifest: {
				...base,
				signalSchemas: [
					{
						name: "Actor Signal",
						slug: "fixture.actor",
						catalogState: "active",
						audiencePolicy: { kind: "actor" },
						notificationHookSlug: "fixture.automation",
						propertiesSchema: {
							unknownKeys: "strict",
							fields: {
								message: {
									type: "string",
									label: "Message",
									description: "Message",
									validation: { required: true },
								},
							},
						},
					},
					{
						name: "Related Signal",
						catalogState: "active",
						slug: "fixture.related",
						notificationHookSlug: "fixture.automation",
						audiencePolicy: {
							kind: "related_users",
							subjectSide: "source",
							relationshipSchemaSlug: "fixture-link",
						},
						propertiesSchema: {
							unknownKeys: "strict",
							fields: {
								count: {
									label: "Count",
									type: "integer",
									description: "Count",
									validation: { required: true },
								},
							},
						},
					},
				],
			},
		};
	return Object.values(
		buildDefinitionSnapshot(mergeManifestDefinitions(kernelDefinitionSource(), [plugin]))
			.signalSchemas,
	);
};

it.effect("indexes and validates strict actor signal contracts", () =>
	Effect.gen(function* () {
		const definition = signalDefinitions().find(({ slug }) => slug === "fixture.actor");
		assert(definition);

		expect(definition.audiencePolicy).toEqual({ kind: "actor" });
		expect(
			yield* parseAppSchemaProperties({
				kind: "Signal",
				properties: { message: "ready" },
				propertiesSchema: definition.propertiesSchema,
			}),
		).toEqual({ message: "ready" });
		expect(
			Result.isFailure(
				yield* Effect.result(
					parseAppSchemaProperties({
						kind: "Signal",
						propertiesSchema: definition.propertiesSchema,
						properties: { message: "ready", unexpected: true },
					}),
				),
			),
		).toBe(true);
	}),
);

it("indexes related-user signal audience policies", () => {
	const definition = signalDefinitions().find(({ slug }) => slug === "fixture.related");
	assert(definition);
	expect(definition.audiencePolicy).toEqual({
		kind: "related_users",
		subjectSide: "source",
		relationshipSchemaSlug: "fixture-link",
	});
});
