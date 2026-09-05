import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";

import { PluginConfigRevisions } from "./config-revisions";
import { ImportSourceCatalog } from "./import-source-catalog";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginRepository } from "./repository";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "./revision.test-support";

const owner = UserId.make("owner");
const packageWithSources = (slug: string, version = "v1") => {
	const plugin = revisionPackage(slug, version);
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			importSources: ["zeta", "alpha"].map((name) => ({
				name,
				slug: `${slug}-${name}`,
				description: "Import source",
				workflowSlug: `${slug}-flow`,
				requiredPluginConfigKeys: [],
				inputSchema: { fields: {}, unknownKeys: "strict" as const },
			})),
		},
	};
};

describe("revision-backed import sources", () => {
	it.effect(
		"lists system and private sources in stable order with executable workflow status",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					yield* installRevisionPackage(packageWithSources("zebra"));
					yield* installRevisionPackage(packageWithSources("apple"), owner);
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
			),
	);
	it.effect("carries immutable config references without exposing private configuration", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(packageWithSources("notes"), owner);
				const installations = yield* PluginInstallationRepository;
				const state = yield* installations.updateState({
					sortOrder: 0,
					isDisabled: false,
					id: installed.installation.id,
					config: { token: "private-catalog-token" },
				});
				const catalog = yield* ImportSourceCatalog.make;
				const resolved = yield* catalog.resolveForUser(owner, "notes-alpha");
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
				expect(yield* catalog.resolveForUser(UserId.make("recipient"), "notes-alpha")).toBeNull();
			}),
		),
	);
	it.effect("resolves matching source and workflow pins after a package upgrade", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				yield* installRevisionPackage(packageWithSources("notes", "v1"), owner);
				const catalog = yield* ImportSourceCatalog.make;
				const before = yield* catalog.resolveForUser(owner, "notes-alpha");
				const upgraded = yield* installRevisionPackage(packageWithSources("notes", "v2"), owner);
				const after = yield* catalog.resolveForUser(owner, "notes-alpha");
				assert(before?.script && after?.script);
				expect(after.script.pluginRevisionId).toBe(upgraded.revisionId);
				expect(after.source.configContext.pluginRevisionId).toBe(after.script.pluginRevisionId);
				expect(after.script.id).not.toBe(before.script.id);
			}),
		),
	);
	it.effect("lets the executable system source win a private slug clash", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
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
				yield* installRevisionPackage(clashing("notes"), owner);
				const system = yield* installRevisionPackage(clashing("zebra"));
				const catalog = yield* ImportSourceCatalog.make;
				expect(
					(yield* catalog.listForUser(owner)).map(({ source }) => [source.slug, source.pluginId]),
				).toEqual([
					["shared-alpha", system.pluginId],
					["shared-zeta", system.pluginId],
				]);
				expect((yield* catalog.resolveForUser(owner, "shared-alpha"))?.source.pluginId).toBe(
					system.pluginId,
				);
			}),
		),
	);
	it.effect("carries only the configured key names of the system environment revision", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(packageWithSources("notes"));
				const catalog = yield* ImportSourceCatalog.make;
				const configuredKeys = catalog
					.resolveForUser(owner, "notes-alpha")
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
				const [stored] = yield* (yield* Database)
					.select({ configuredKeys: tables.pluginConfigRevision.configuredKeys })
					.from(tables.pluginConfigRevision)
					.where(eq(tables.pluginConfigRevision.id, configRevisionId));
				expect(stored).toEqual({ configuredKeys: ["token"] });
			}),
		),
	);
});
