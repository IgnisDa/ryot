import { expect, layer } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginId, PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { assert, describe } from "vitest";

import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "../packages/revision.test-support";
import { testPluginPackageId } from "../test-support";
import { IntegrationProviderCatalog } from "./integration-providers";

const owner = UserId.make("owner");
const packageWithProviders = (slug: string, version = "v1", packageId = testPluginPackageId()) => {
	const plugin = revisionPackage(slug, version, undefined, packageId);
	const integrationProviders: PluginManifest["integrationProviders"] = [
		{
			lot: "push",
			name: "Push",
			description: "Push",
			slug: `${slug}-push`,
			settingsSchema: { fields: {} },
		},
		{
			lot: "sink",
			name: "Sink",
			description: "Sink",
			slug: `${slug}-sink`,
			scriptSlug: `${slug}.task`,
			settingsSchema: { fields: {} },
		},
		{
			lot: "yank",
			name: "Yank",
			description: "Yank",
			slug: `${slug}-yank`,
			scriptSlug: `${slug}.task`,
			settingsSchema: { fields: {} },
		},
	];
	return { ...plugin, manifest: { ...plugin.manifest, integrationProviders } };
};

const clashing = (slug: string) => {
	const plugin = packageWithProviders(slug);
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			integrationProviders: plugin.manifest.integrationProviders.map((provider) =>
				Object.assign({}, provider, { slug: `shared-${provider.lot}` }),
			),
		},
	};
};

describe("revision-backed integration providers", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"lists providers by plugin and slug and resolves each lot's executable declaration",
			() =>
				Effect.gen(function* () {
					yield* installRevisionPackage(
						packageWithProviders("zebra", "v1", PluginPackageId.make("test/zebra")),
					);
					yield* installRevisionPackage(
						packageWithProviders("apple", "v1", PluginPackageId.make("test/apple")),
						owner,
					);
					const catalog = yield* IntegrationProviderCatalog.make;
					const rows = yield* catalog.listResolvedForUser(owner);
					expect(rows.map(({ provider }) => provider.slug)).toEqual([
						"apple-push",
						"apple-sink",
						"apple-yank",
						"zebra-push",
						"zebra-sink",
						"zebra-yank",
					]);
					for (const { script, provider } of rows) {
						if (provider.lot === "push") {
							expect(script).toBeNull();
						} else {
							expect(script?.pluginRevisionId).toBe(provider.configContext.pluginRevisionId);
						}
					}
				}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"requires the caller's exact installation and excludes other users' private providers",
			() =>
				Effect.gen(function* () {
					const first = yield* installRevisionPackage(packageWithProviders("notes"), owner);
					const second = yield* installRevisionPackage(
						packageWithProviders("notes"),
						UserId.make("recipient"),
					);
					const catalog = yield* IntegrationProviderCatalog.make;
					expect(
						yield* catalog.findOwnedForUser(owner, "notes-sink", second.installation.id),
					).toBeNull();
					expect(
						yield* catalog.resolveOwnedForUser(owner, "notes-sink", second.installation.id),
					).toBeNull();
					const resolved = yield* catalog.resolveOwnedForUser(
						owner,
						"notes-sink",
						first.installation.id,
					);
					assert(resolved?.script);
					expect(resolved.script.pluginRevisionId).toBe(first.revisionId);
					expect(resolved.provider.configContext.ownerUserId).toBe(owner);
				}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect("switches both script and config references on upgrade", () =>
			Effect.gen(function* () {
				const original = packageWithProviders("notes", "v1");
				const installed = yield* installRevisionPackage(original, owner);
				const catalog = yield* IntegrationProviderCatalog.make;
				const before = yield* catalog.resolveOwnedForUser(
					owner,
					"notes-sink",
					installed.installation.id,
				);
				const next = packageWithProviders("notes", "v2");
				const updated = yield* installRevisionPackage(
					{
						...next,
						manifest: {
							...next.manifest,
							metadata: {
								...next.manifest.metadata,
								packageId: original.manifest.metadata.packageId,
							},
						},
					},
					owner,
				);
				const after = yield* catalog.resolveOwnedForUser(
					owner,
					"notes-sink",
					installed.installation.id,
				);
				assert(before?.script && after?.script);
				expect(after.script.id).not.toBe(before.script.id);
				expect(after.provider.configContext.pluginConfigRevisionId).not.toBe(
					before.provider.configContext.pluginConfigRevisionId,
				);
				expect(after.script.pluginRevisionId).toBe(updated.revisionId);
			}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect("keeps same-name integration providers and selects their exact installations", () =>
			Effect.gen(function* () {
				const privatePlugin = yield* installRevisionPackage(clashing("whiskey"), owner);
				const system = yield* installRevisionPackage(clashing("whiskey"));
				const catalog = yield* IntegrationProviderCatalog.make;
				expect(
					(yield* catalog.listResolvedForUser(owner)).map(({ provider }) => provider.pluginId),
				).toEqual(expect.arrayContaining([system.pluginId, privatePlugin.pluginId]));
				expect(yield* catalog.listResolvedForUser(owner)).toHaveLength(6);
				expect(
					(yield* catalog.findForUser(owner, {
						slug: "shared-sink",
						owner: { kind: "plugin", pluginId: PluginId.make(system.pluginId) },
					}))?.installationId,
				).toBe(system.installation.id);
				expect(
					(yield* catalog.findForUser(owner, {
						slug: "shared-sink",
						owner: { kind: "plugin", pluginId: PluginId.make(privatePlugin.pluginId) },
					}))?.installationId,
				).toBe(privatePlugin.installation.id);
				expect(
					yield* catalog.findForUser(owner, { slug: "shared-sink", owner: { kind: "kernel" } }),
				).toBeNull();
			}),
		);
	});
});
