import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { assert, describe } from "vitest";

import { IntegrationProviderCatalog } from "./integration-provider-catalog";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "./revision.test-support";

const owner = UserId.make("owner");
const packageWithProviders = (slug: string, version = "v1") => {
	const plugin = revisionPackage(slug, version);
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

describe("revision-backed integration providers", () => {
	it.effect(
		"lists providers by plugin and slug and resolves each lot's executable declaration",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					yield* installRevisionPackage(packageWithProviders("zebra"));
					yield* installRevisionPackage(packageWithProviders("apple"), owner);
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
			),
	);
	it.effect(
		"requires the caller's exact installation and excludes other users' private providers",
		() =>
			withRevisionDatabase(
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
			),
	);
	it.effect("switches both script and config references on upgrade", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(packageWithProviders("notes", "v1"), owner);
				const catalog = yield* IntegrationProviderCatalog.make;
				const before = yield* catalog.resolveOwnedForUser(
					owner,
					"notes-sink",
					installed.installation.id,
				);
				const updated = yield* installRevisionPackage(packageWithProviders("notes", "v2"), owner);
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
		),
	);
	it.effect("lets the executable system provider win a private slug clash", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
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
				yield* installRevisionPackage(clashing("notes"), owner);
				const system = yield* installRevisionPackage(clashing("zebra"));
				const catalog = yield* IntegrationProviderCatalog.make;
				expect(
					(yield* catalog.listResolvedForUser(owner)).map(({ provider }) => provider.pluginId),
				).toEqual([system.pluginId, system.pluginId, system.pluginId]);
				expect((yield* catalog.findForUser(owner, "shared-sink"))?.pluginId).toBe(system.pluginId);
			}),
		),
	);
});
