import { assert, expect, it } from "@effect/vitest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { fixtureManifest } from "../test-support";
import { validatePluginManifestPolicy, validatePluginManifestReferences } from "./validation";

it.effect("resolves hook targets and relationship endpoints only from local declarations", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		expect(yield* validatePluginManifestReferences(manifest)).toBeUndefined();
		const foreignHook = { ...manifest, entitySchemas: [], relationshipSchemas: [] };
		expect(yield* Effect.flip(validatePluginManifestReferences(foreignHook))).toMatchObject({
			issues: ["Automation hook references missing definition: fixture-entity"],
		});
		const foreignEndpoint = {
			...manifest,
			relationshipSchemas: Array.from(manifest.relationshipSchemas, (definition) => ({
				...definition,
				targetEntitySchemaSlug: "collection",
			})),
		};
		expect(yield* Effect.flip(validatePluginManifestReferences(foreignEndpoint))).toMatchObject({
			issues: ["Relationship endpoint references missing definition: collection"],
		});
	}),
);

it.effect(
	"allows same local declaration slugs across packages but rejects duplicates in a package",
	() =>
		Effect.gen(function* () {
			const a = fixtureManifest();
			const b = fixtureManifest(PluginPackageId.make("test/second"));
			expect(yield* validatePluginManifestReferences(a)).toBeUndefined();
			expect(yield* validatePluginManifestReferences(b)).toBeUndefined();
			expect(
				yield* Effect.flip(
					validatePluginManifestReferences({
						...a,
						entitySchemas: [...a.entitySchemas, ...a.entitySchemas],
					}),
				),
			).toMatchObject({ issues: ["Duplicate entity schema slug: fixture-entity"] });
		}),
);

it.effect(
	"permits private bootstrap and local data-json names without deployment capabilities",
	() =>
		Effect.gen(function* () {
			const manifest = fixtureManifest();
			const bootstrap = {
				...manifest,
				hooks: [],
				signalSchemas: [],
				workflows: [{ slug: "import", scriptSlug: "import" }],
				userBootstrap: [{ slug: "init", scriptSlug: "init", description: "Initialize" }],
				importSources: [
					{
						slug: "data-json",
						name: "Local JSON",
						workflowSlug: "import",
						description: "Local JSON",
						inputSchema: { fields: {} },
					},
				],
				scripts: [
					{
						...manifest.scripts[0],
						name: "Init",
						slug: "init",
						capabilities: [],
						runtimeImports: [],
						kind: "script" as const,
						oauthConnectionFields: [],
						executableDependencies: [],
						requiredPluginConfigKeys: [],
						optionalPluginConfigKeys: [],
						entry: "backend/init.sandbox.ts",
					},
				],
			};
			expect(
				yield* validatePluginManifestPolicy(bootstrap, {
					scope: "user",
					systemPackageIds: new Set(),
				}),
			).toBeUndefined();
			expect(yield* Effect.flip(validatePluginManifestReferences(bootstrap))).toMatchObject({
				issues: ["Workflow references missing definition: import"],
			});
			const direct = manifest.scripts[0];
			assert(direct);
			const localImport = {
				...bootstrap,
				scripts: [...bootstrap.scripts, { ...direct, slug: "import", kind: "workflow" as const }],
			};
			expect(yield* validatePluginManifestReferences(localImport)).toBeUndefined();
		}),
);

it.effect("reserves canonical package identities rather than route or display names", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		expect(
			yield* Effect.flip(
				validatePluginManifestPolicy(manifest, {
					scope: "user",
					systemPackageIds: new Set([manifest.metadata.packageId]),
				}),
			),
		).toMatchObject({ _tag: "PluginPackageReservedError", packageId: manifest.metadata.packageId });
		expect(yield* validatePluginManifestPolicy(manifest, { scope: "system" })).toBeUndefined();
	}),
);
