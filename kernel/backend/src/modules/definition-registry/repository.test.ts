import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "#modules/plugins/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/types";

import { kernelDefinitionSource } from "./kernel-source";
import { DefinitionRepository } from "./repository";
import { seedKernelDefinitions } from "./test-support";

const owner = UserId.make("owner");
const effective = { listed: false } as const;
const listed = { listed: true } as const;

const setInstallation = Effect.fn(function* (
	installationId: string,
	patch: Partial<typeof tables.pluginInstallation.$inferInsert>,
) {
	const db = yield* Database;
	yield* db
		.update(tables.pluginInstallation)
		.set(patch)
		.where(eq(tables.pluginInstallation.id, installationId));
});

const userPlugin = Effect.fn(function* (pluginId: string) {
	const db = yield* Database;
	const [row] = yield* db
		.select({
			isListed: tables.userPlugin.isListed,
			isExecutable: tables.userPlugin.isExecutable,
			isDefinitionEffective: tables.userPlugin.isDefinitionEffective,
		})
		.from(tables.userPlugin)
		.where(and(eq(tables.userPlugin.userId, owner), eq(tables.userPlugin.pluginId, pluginId)));
	return row ?? null;
});

const entitySlugs = Effect.fn(function* (options: { readonly listed: boolean }) {
	const definitions = yield* DefinitionRepository;
	return Object.keys((yield* definitions.getUserSnapshot(owner, options)).entitySchemas).sort();
});

const linkedTo = (packageValue: NormalizedPlugin, targetEntitySchemaSlug: string) => ({
	...packageValue,
	manifest: {
		...packageValue.manifest,
		relationshipSchemas: packageValue.manifest.relationshipSchemas.map((relationship) => ({
			...relationship,
			targetEntitySchemaSlug,
		})),
	},
});

describe("definition views", () => {
	it.effect("shadows private definitions with the global system set", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const definitions = yield* DefinitionRepository;
				yield* seedKernelDefinitions();
				const system = yield* installRevisionPackage(revisionPackage());
				yield* installRevisionPackage(revisionPackage("private", "v1", "fixture-entity"), owner);

				const snapshot = yield* definitions.getUserSnapshot(owner, effective);
				expect(snapshot.entitySchemas["fixture-entity"]?.pluginId).toBe(system.pluginId);
				expect(Object.keys(snapshot.relationshipSchemas)).toEqual([
					"private-link",
					"fixture-link",
					"member-of",
				]);

				yield* setInstallation(system.installation.id, { isDisabled: true });
				const disabled = yield* definitions.getUserSnapshot(owner, effective);
				expect(disabled.entitySchemas["fixture-entity"]).toBeUndefined();
				expect(disabled.relationshipSchemas["private-link"]).toBeUndefined();
				expect(disabled.entitySchemas["collection"]).toBeDefined();
			}),
		),
	);

	it.effect("separates listed from effective installations", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const system = yield* installRevisionPackage(revisionPackage());
				const installing = yield* installRevisionPackage(revisionPackage("alpha"), owner);
				const disabled = yield* installRevisionPackage(revisionPackage("beta"), owner);
				const incompatible = yield* installRevisionPackage(revisionPackage("gamma"), owner);
				yield* setInstallation(system.installation.id, { health: "installing" });
				yield* setInstallation(installing.installation.id, { health: "installing" });
				yield* setInstallation(disabled.installation.id, { isDisabled: true });
				yield* setInstallation(incompatible.installation.id, { health: "incompatible" });

				expect(yield* userPlugin(system.pluginId)).toEqual({
					isListed: true,
					isExecutable: false,
					isDefinitionEffective: true,
				});
				expect(yield* userPlugin(installing.pluginId)).toEqual({
					isListed: true,
					isExecutable: false,
					isDefinitionEffective: false,
				});
				expect(yield* userPlugin(disabled.pluginId)).toEqual({
					isListed: true,
					isExecutable: false,
					isDefinitionEffective: false,
				});
				expect(yield* userPlugin(incompatible.pluginId)).toEqual({
					isListed: false,
					isExecutable: false,
					isDefinitionEffective: false,
				});
				expect(yield* entitySlugs(listed)).toEqual([
					"alpha-entity",
					"beta-entity",
					"fixture-entity",
				]);
				expect(yield* entitySlugs(effective)).toEqual(["fixture-entity"]);
			}),
		),
	);

	it.effect("drops private relationships whose endpoints are not available", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const definitions = yield* DefinitionRepository;
				const alpha = yield* installRevisionPackage(revisionPackage("alpha"), owner);
				yield* installRevisionPackage(linkedTo(revisionPackage("beta"), "alpha-entity"), owner);
				yield* setInstallation(alpha.installation.id, { health: "installing" });

				const relationshipSlugs = (options: { readonly listed: boolean }) =>
					definitions
						.getUserSnapshot(owner, options)
						.pipe(Effect.map((snapshot) => Object.keys(snapshot.relationshipSchemas).sort()));
				expect(yield* relationshipSlugs(listed)).toEqual(["alpha-link", "beta-link"]);
				expect(yield* relationshipSlugs(effective)).toEqual([]);
				expect(yield* entitySlugs(effective)).toEqual(["beta-entity"]);

				yield* setInstallation(alpha.installation.id, { health: "incompatible" });
				expect(yield* relationshipSlugs(listed)).toEqual([]);
			}),
		),
	);

	it.effect("excludes uninstalled installations", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const installations = yield* PluginInstallationRepository;
				const installed = yield* installRevisionPackage(revisionPackage("alpha"), owner);
				yield* installations.remove(installed.installation.id);

				expect(yield* userPlugin(installed.pluginId)).toBeNull();
				expect(yield* entitySlugs(listed)).toEqual([]);
			}),
		),
	);

	it.effect("executes only plugins whose configuration is pinned to the active revision", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const plugins = yield* PluginRepository;
				const system = yield* installRevisionPackage(revisionPackage());
				const alpha = yield* installRevisionPackage(revisionPackage("alpha"), owner);
				expect((yield* userPlugin(system.pluginId))?.isExecutable).toBe(true);
				expect((yield* userPlugin(alpha.pluginId))?.isExecutable).toBe(true);

				yield* plugins.persist(revisionPackage("alpha", "v2"), {
					slug: "alpha",
					scope: "user",
					ownerId: owner,
				});
				expect((yield* userPlugin(alpha.pluginId))?.isExecutable).toBe(false);

				const [pinned] = yield* db
					.select({ configRevisionId: tables.globalPlugin.configRevisionId })
					.from(tables.globalPlugin)
					.where(eq(tables.globalPlugin.pluginId, system.pluginId));
				assert(pinned?.configRevisionId);
				yield* plugins.persist(revisionPackage("fixture", "v2"), {
					ownerId: null,
					slug: "fixture",
					scope: "system",
				});
				const [unpinned] = yield* db
					.select({
						isExecutable: tables.globalPlugin.isExecutable,
						configRevisionId: tables.globalPlugin.configRevisionId,
					})
					.from(tables.globalPlugin)
					.where(eq(tables.globalPlugin.pluginId, system.pluginId));
				expect(unpinned).toEqual({ isExecutable: false, configRevisionId: null });
				expect((yield* userPlugin(system.pluginId))?.isExecutable).toBe(false);

				const exit = yield* Effect.exit(
					plugins.setEnvironmentConfigRevision(system.pluginId, pinned.configRevisionId),
				);
				expect(Exit.isFailure(exit)).toBe(true);
			}),
		),
	);

	it.effect("upserts kernel definitions by slug and prunes removed rows", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const definitions = yield* DefinitionRepository;
				const source = kernelDefinitionSource();
				yield* seedKernelDefinitions(source);
				const kernelEntities = db
					.select({
						id: tables.definitionEntitySchema.id,
						name: tables.definitionEntitySchema.name,
					})
					.from(tables.definitionEntitySchema)
					.where(isNull(tables.definitionEntitySchema.pluginRevisionId));
				const [seeded] = yield* kernelEntities;
				assert(seeded);

				const [collection] = source.entitySchemas;
				assert(collection);
				yield* seedKernelDefinitions({
					...source,
					relationshipSchemas: [],
					entitySchemas: [
						{
							...collection,
							name: "Renamed",
							eventSchemas: collection.eventSchemas.filter(({ slug }) => slug !== "review"),
						},
					],
				});

				expect(yield* kernelEntities).toEqual([{ id: seeded.id, name: "Renamed" }]);
				const snapshot = yield* definitions.getUserSnapshot(UserId.make("recipient"), effective);
				expect(snapshot.relationshipSchemas).toEqual({});
				expect(Object.keys(snapshot.entitySchemas["collection"]?.eventSchemas ?? {})).toEqual([
					"add-entity-to-collection",
					"remove-entity-from-collection",
				]);
				expect(yield* definitions.readKernelSource).toMatchObject({
					relationshipSchemas: [],
					savedViews: [{ pluginId: null, slug: "collections" }],
				});
			}),
		),
	);
});
