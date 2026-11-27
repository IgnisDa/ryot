import { expect } from "bun:test";

import type { PluginMembership } from "@ryot-app/contract/modules/plugins/manifest";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Exit } from "effect";

import { validatePluginManifestReferences } from "./validation";

const membership: PluginMembership = {
	slug: "fixture-library",
	recordEventSchemaSlug: "changed",
	relationshipSchemaSlug: "fixture-link",
	targetEntitySchemaSlug: "fixture-entity",
	memberEntitySchemaSlugs: ["fixture-entity"],
	join: {
		events: true,
		providerImport: true,
		kernelCollectionAdd: true,
		entityCreate: ["fixture-entity"],
	},
};

const withMembership = (overrides: Partial<PluginMembership>, bootstrapped = true) => ({
	...fixtureManifest(),
	memberships: [{ ...membership, ...overrides }],
	userBootstrap: bootstrapped
		? [
				{
					slug: "library",
					description: "Fixture library",
					entities: [{ properties: {}, name: "Library", entitySchemaSlug: "fixture-entity" }],
				},
			]
		: [],
});

it.effect(
	"accepts a membership into a bootstrap-declared target and rejects broken references",
	() =>
		Effect.gen(function* () {
			yield* validatePluginManifestReferences(withMembership({}));
			const rejected = [
				withMembership({}, false),
				withMembership({ relationshipSchemaSlug: "missing-link" }),
				withMembership({ memberEntitySchemaSlugs: ["missing-entity"] }),
				withMembership({ recordEventSchemaSlug: "missing-event" }),
				withMembership({ join: { ...membership.join, entityCreate: ["other-entity"] } }),
			];
			for (const manifest of rejected) {
				expect(Exit.isFailure(yield* Effect.exit(validatePluginManifestReferences(manifest)))).toBe(
					true,
				);
			}
		}),
);
