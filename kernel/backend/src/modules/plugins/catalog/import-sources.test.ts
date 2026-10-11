import { expect, layer } from "@effect/vitest";
import { PluginId, PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { assert, describe } from "vitest";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { PluginConfigRevisions } from "../configuration/revisions";
import { PluginInstallationRepository } from "../installations/repository";
import { PluginRepository } from "../packages/repository";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "../packages/revision.test-support";
import { testPluginPackageId } from "../test-support";
import { ImportSourceCatalog } from "./import-sources";

const owner = UserId.make("owner");
const packageWithSources = (slug: string, version = "v1", packageId = testPluginPackageId()) => {
	const plugin = revisionPackage(slug, version, undefined, packageId);
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			importSources: ["zeta", "alpha"].map((name) => ({
				name,
				slug: `${slug}-${name}`,
				description: "Import source",
				workflowSlug: `${slug}-flow`,
				inputSchema: { fields: {}, unknownKeys: "strict" as const },
			})),
		},
	};
};

const clashing = (slug: string) => {
	const plugin = packageWithSources(slug);
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			importSources: plugin.manifest.importSources.map((source) =>
				Object.assign({}, source, { slug: `shared-${source.name}` }),
			),
		},
	};
};

describe("revision-backed import sources", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"lists system and private sources in stable order with executable workflow status",
			() =>
				Effect.gen(function* () {
					yield* installRevisionPackage(
						packageWithSources("zebra", "v1", PluginPackageId.make("test/zebra")),
					);
					yield* installRevisionPackage(
						packageWithSources("apple", "v1", PluginPackageId.make("test/apple")),
						owner,
					);
					const catalog = yield* ImportSourceCatalog.make;
					const rows = yield* catalog.listForUser(owner);
					expect(rows.map(({ source }) => source.slug)).toEqual([
						"apple-alpha",
						"apple-zeta",
						"zebra-alpha",
						"zebra-zeta",
					]);
					expect(rows.every(({ hasActiveWorkflow }) => hasActiveWorkflow)).toBe(true);
				}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect("carries immutable config references without exposing private configuration", () =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(packageWithSources("notes"), owner);
				const installations = yield* PluginInstallationRepository;
				const state = yield* installations.updateState({
					sortOrder: 0,
					isHidden: false,
					id: installed.installation.id,
					config: { token: "private-catalog-token" },
				});
				const catalog = yield* ImportSourceCatalog.make;
				const reference = {
					slug: "notes-alpha",
					owner: { kind: "plugin" as const, pluginId: PluginId.make(installed.pluginId) },
				};
				const resolved = yield* catalog.resolveForUser(owner, reference);
				assert(resolved?.script);
				expect(resolved.source.installationId).toBe(installed.installation.id);
				expect(resolved.source.configContext).toMatchObject({
					kind: "revision",
					ownerUserId: owner,
					pluginRevisionId: installed.revisionId,
					pluginConfigRevisionId: state?.activeConfigRevisionId,
				});
				expect(resolved.script.pluginRevisionId).toBe(
					resolved.source.configContext.pluginRevisionId,
				);
				expect(resolved.source).not.toHaveProperty("config");
				expect(resolved.source.configContext).not.toHaveProperty("config");
				expect(yield* catalog.resolveForUser(UserId.make("recipient"), reference)).toBeNull();
			}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect("resolves matching source and workflow pins after a package upgrade", () =>
			Effect.gen(function* () {
				const original = packageWithSources("notes", "v1");
				const installed = yield* installRevisionPackage(original, owner);
				const catalog = yield* ImportSourceCatalog.make;
				const reference = {
					slug: "notes-alpha",
					owner: { kind: "plugin" as const, pluginId: PluginId.make(installed.pluginId) },
				};
				const before = yield* catalog.resolveForUser(owner, reference);
				const next = packageWithSources("notes", "v2");
				const upgraded = yield* installRevisionPackage(
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
				const after = yield* catalog.resolveForUser(owner, reference);
				assert(before?.script && after?.script);
				expect(after.script.pluginRevisionId).toBe(upgraded.revisionId);
				expect(after.source.configContext.pluginRevisionId).toBe(after.script.pluginRevisionId);
				expect(after.script.id).not.toBe(before.script.id);
			}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect("selects independent same-name sources by exact owner", () =>
			Effect.gen(function* () {
				const privatePackage = clashing("whiskey");
				const privatePlugin = yield* installRevisionPackage(privatePackage, owner);
				const systemPackage = clashing("whiskey");
				const system = yield* installRevisionPackage({
					...systemPackage,
					manifest: {
						...systemPackage.manifest,
						metadata: { ...systemPackage.manifest.metadata, packageId: testPluginPackageId() },
					},
				});
				const catalog = yield* ImportSourceCatalog.make;
				expect(
					(yield* catalog.listForUser(owner)).map(({ source }) => [source.slug, source.pluginId]),
				).toEqual(
					expect.arrayContaining([
						["shared-alpha", privatePlugin.pluginId],
						["shared-zeta", privatePlugin.pluginId],
						["shared-alpha", system.pluginId],
						["shared-zeta", system.pluginId],
					]),
				);
				expect(yield* catalog.listForUser(owner)).toHaveLength(4);
				expect(
					(yield* catalog.resolveForUser(owner, {
						slug: "shared-alpha",
						owner: { kind: "plugin", pluginId: PluginId.make(system.pluginId) },
					}))?.source.pluginId,
				).toBe(system.pluginId);
				expect(
					(yield* catalog.resolveForUser(owner, {
						slug: "shared-alpha",
						owner: { kind: "plugin", pluginId: PluginId.make(privatePlugin.pluginId) },
					}))?.source.installationId,
				).toBe(privatePlugin.installation.id);
				expect(
					yield* catalog.resolveForUser(owner, { slug: "shared-alpha", owner: { kind: "kernel" } }),
				).toBeNull();
			}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect("carries only the configured key names of the system environment revision", () =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(packageWithSources("notes"));
				const catalog = yield* ImportSourceCatalog.make;
				const configuredKeys = catalog
					.resolveForUser(owner, {
						slug: "notes-alpha",
						owner: { kind: "plugin", pluginId: PluginId.make(installed.pluginId) },
					})
					.pipe(Effect.map((resolved) => resolved?.source.configuredPluginConfigKeys));
				expect(yield* configuredKeys).toEqual([]);
				const configRevisionId = yield* (yield* PluginConfigRevisions).create({
					ownerUserId: null,
					scope: "environment",
					pluginInstallationId: null,
					pluginRevisionId: installed.revisionId,
					properties: { token: "environment-secret" },
				});
				yield* (yield* PluginRepository).setEnvironmentConfigRevision(
					installed.pluginId,
					configRevisionId,
				);
				expect(yield* configuredKeys).toEqual(["token"]);
				const [stored] = yield* (yield* DatabaseSession).run((db) =>
					db
						.select({ configuredKeys: tables.pluginConfigRevision.configuredKeys })
						.from(tables.pluginConfigRevision)
						.where(eq(tables.pluginConfigRevision.id, configRevisionId)),
				);
				expect(stored).toEqual({ configuredKeys: ["token"] });
			}),
		);
	});
});
