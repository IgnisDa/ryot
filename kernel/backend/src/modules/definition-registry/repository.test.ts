import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
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
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.update(tables.pluginInstallation)
			.set(patch)
			.where(eq(tables.pluginInstallation.id, installationId)),
	);
});

const userPlugin = Effect.fn(function* (pluginId: string) {
	const session = yield* DatabaseSession;
	const [row] = yield* session.run((db) =>
		db
			.select({
				isListed: tables.userPlugin.isListed,
				isExecutable: tables.userPlugin.isExecutable,
				isDefinitionEffective: tables.userPlugin.isDefinitionEffective,
			})
			.from(tables.userPlugin)
			.where(and(eq(tables.userPlugin.userId, owner), eq(tables.userPlugin.pluginId, pluginId))),
	);
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

const relationshipSchema = (slug: string, source: string, target: string) => ({
	slug,
	name: slug,
	sourceEntitySchemaSlug: source,
	targetEntitySchemaSlug: target,
	propertiesSchema: { fields: {} },
});

const withRelationshipSchemas = (
	packageValue: NormalizedPlugin,
	relationshipSchemas: NormalizedPlugin["manifest"]["relationshipSchemas"],
) => ({ ...packageValue, manifest: { ...packageValue.manifest, relationshipSchemas } });

const withoutSignalAndSavedViewDefinitions = (packageValue: NormalizedPlugin) => ({
	...packageValue,
	manifest: { ...packageValue.manifest, hooks: [], savedViews: [], signalSchemas: [] },
});

describe("definition views", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("finds requested global relationship schemas in view precedence order", () =>
			Effect.gen(function* () {
				const definitions = yield* DefinitionRepository;
				const kernel = kernelDefinitionSource();
				yield* seedKernelDefinitions({
					...kernel,
					relationshipSchemas: [
						relationshipSchema("kernel-pair", "shared-source", "shared-target"),
						relationshipSchema("kernel-other-target", "shared-source", "other-target"),
					],
				});
				const alpha = yield* installRevisionPackage(
					withRelationshipSchemas(revisionPackage("alpha"), [
						relationshipSchema("alpha-pair", "shared-source", "shared-target"),
					]),
				);
				const beta = yield* installRevisionPackage(
					withRelationshipSchemas(revisionPackage("beta"), [
						relationshipSchema("beta-pair", "shared-source", "shared-target"),
					]),
				);

				const found = yield* definitions.findGlobalRelationshipSchemas([
					"beta-pair",
					"kernel-other-target",
					"alpha-pair",
					"not-requested",
				]);
				expect(Object.keys(found)).toEqual(["alpha-pair", "beta-pair", "kernel-other-target"]);
				expect(found["alpha-pair"]?.pluginId).toBe(alpha.pluginId);
				expect(found["beta-pair"]?.pluginId).toBe(beta.pluginId);
				expect(found["kernel-other-target"]?.pluginId).toBeNull();
				expect(yield* definitions.findGlobalRelationshipSchemas(["not-found"])).toEqual({});
				expect(yield* definitions.findGlobalRelationshipSchemas([])).toEqual({});
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"reads the global and effective entity relationship catalogs without signals or saved views",
			() =>
				Effect.gen(function* () {
					const definitions = yield* DefinitionRepository;
					expect(yield* definitions.getGlobalEntityRelationshipDefinitions).toEqual({
						entitySchemas: {},
						relationshipSchemas: {},
					});
					expect(yield* definitions.getUserEntityRelationshipDefinitions(owner)).toEqual({
						entitySchemas: {},
						relationshipSchemas: {},
					});
					const kernel = kernelDefinitionSource();
					yield* seedKernelDefinitions({ ...kernel, savedViews: [], signalSchemas: [] });
					const system = yield* installRevisionPackage(
						withoutSignalAndSavedViewDefinitions(revisionPackage("system")),
					);
					const privatePlugin = yield* installRevisionPackage(
						withoutSignalAndSavedViewDefinitions(revisionPackage("private")),
						owner,
					);
					const hiddenPlugin = yield* installRevisionPackage(
						withoutSignalAndSavedViewDefinitions(revisionPackage("hidden")),
						owner,
					);
					yield* setInstallation(hiddenPlugin.installation.id, { isHidden: true });

					const globalDefinitions = yield* definitions.getGlobalEntityRelationshipDefinitions;
					const globalSnapshot = yield* definitions.getGlobalSnapshot;
					expect(globalDefinitions.entitySchemas).toEqual({
						collection: { pluginId: null, slug: "collection" },
						"system-entity": { slug: "system-entity", pluginId: system.pluginId },
					});
					expect(Object.keys(globalDefinitions.entitySchemas)).toEqual([
						"collection",
						"system-entity",
					]);
					expect(globalDefinitions.entitySchemas).toEqual(
						Object.fromEntries(
							Object.values(globalSnapshot.entitySchemas).map(({ slug, pluginId }) => [
								slug,
								{ slug, pluginId },
							]),
						),
					);
					expect(globalSnapshot.savedViews).toEqual({});
					expect(globalSnapshot.signalSchemas).toEqual({});
					expect(globalDefinitions.relationshipSchemas).toEqual(globalSnapshot.relationshipSchemas);
					expect(globalDefinitions.relationshipSchemas["member-of"]?.pluginId).toBeNull();
					expect(globalDefinitions.relationshipSchemas["system-link"]?.pluginId).toBe(
						system.pluginId,
					);
					expect(Object.keys(globalDefinitions.relationshipSchemas)).toEqual([
						"system-link",
						"member-of",
					]);

					const userDefinitions = yield* definitions.getUserEntityRelationshipDefinitions(owner);
					const userSnapshot = yield* definitions.getUserSnapshot(owner, effective);
					expect(userDefinitions.entitySchemas).toEqual({
						collection: { pluginId: null, slug: "collection" },
						"system-entity": { slug: "system-entity", pluginId: system.pluginId },
						"private-entity": { slug: "private-entity", pluginId: privatePlugin.pluginId },
					});
					expect(Object.keys(userDefinitions.entitySchemas)).toEqual([
						"collection",
						"system-entity",
						"private-entity",
					]);
					expect(userDefinitions.entitySchemas).toEqual(
						Object.fromEntries(
							Object.values(userSnapshot.entitySchemas).map(({ slug, pluginId }) => [
								slug,
								{ slug, pluginId },
							]),
						),
					);
					expect(userSnapshot.savedViews).toEqual({});
					expect(userSnapshot.signalSchemas).toEqual({});
					expect(userDefinitions.relationshipSchemas).toEqual(userSnapshot.relationshipSchemas);
					expect(userDefinitions.relationshipSchemas["member-of"]?.pluginId).toBeNull();
					expect(userDefinitions.relationshipSchemas["system-link"]?.pluginId).toBe(
						system.pluginId,
					);
					expect(userDefinitions.relationshipSchemas["private-link"]?.pluginId).toBe(
						privatePlugin.pluginId,
					);
					expect(Object.keys(userDefinitions.relationshipSchemas)).toEqual([
						"private-link",
						"system-link",
						"member-of",
					]);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"finds global relationship schemas by both endpoints in view precedence order",
			() =>
				Effect.gen(function* () {
					const definitions = yield* DefinitionRepository;
					const kernel = kernelDefinitionSource();
					yield* seedKernelDefinitions({
						...kernel,
						relationshipSchemas: [
							relationshipSchema("kernel-pair", "shared-source", "shared-target"),
							relationshipSchema("kernel-other-target", "shared-source", "other-target"),
						],
					});
					const alpha = yield* installRevisionPackage(
						withRelationshipSchemas(revisionPackage("alpha"), [
							relationshipSchema("alpha-pair", "shared-source", "shared-target"),
						]),
					);
					yield* installRevisionPackage(
						withRelationshipSchemas(revisionPackage("beta"), [
							relationshipSchema("beta-pair", "shared-source", "shared-target"),
						]),
					);

					expect(
						yield* definitions.findGlobalRelationshipSchemaByEndpoints(
							"shared-source",
							"shared-target",
						),
					).toMatchObject({ slug: "alpha-pair", pluginId: alpha.pluginId });
					expect(
						yield* definitions.findGlobalRelationshipSchemaByEndpoints(
							"shared-source",
							"other-target",
						),
					).toMatchObject({ pluginId: null, slug: "kernel-other-target" });
					expect(
						yield* definitions.findGlobalRelationshipSchemaByEndpoints(
							"shared-source",
							"missing-target",
						),
					).toBeNull();
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("shadows private definitions with the global system set", () =>
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

				yield* setInstallation(system.installation.id, { isHidden: true });
				const hidden = yield* definitions.getUserSnapshot(owner, effective);
				expect(hidden.entitySchemas["fixture-entity"]).toBeUndefined();
				expect(hidden.relationshipSchemas["private-link"]).toBeUndefined();
				expect(hidden.entitySchemas["collection"]).toBeDefined();
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("separates listed from effective installations", () =>
			Effect.gen(function* () {
				const system = yield* installRevisionPackage(revisionPackage());
				const installing = yield* installRevisionPackage(revisionPackage("alpha"), owner);
				const hidden = yield* installRevisionPackage(revisionPackage("beta"), owner);
				const incompatible = yield* installRevisionPackage(revisionPackage("gamma"), owner);
				yield* setInstallation(system.installation.id, { health: "installing" });
				yield* setInstallation(installing.installation.id, { health: "installing" });
				yield* setInstallation(hidden.installation.id, { isHidden: true });
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
				expect(yield* userPlugin(hidden.pluginId)).toEqual({
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
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("drops private relationships whose endpoints are not available", () =>
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
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("excludes uninstalled installations", () =>
			Effect.gen(function* () {
				const installations = yield* PluginInstallationRepository;
				const installed = yield* installRevisionPackage(revisionPackage("alpha"), owner);
				yield* installations.remove(installed.installation.id);

				expect(yield* userPlugin(installed.pluginId)).toBeNull();
				expect(yield* entitySlugs(listed)).toEqual([]);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("executes only plugins whose configuration is pinned to the active revision", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
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

				const [pinned] = yield* session.run((db) =>
					db
						.select({ configRevisionId: tables.globalPlugin.configRevisionId })
						.from(tables.globalPlugin)
						.where(eq(tables.globalPlugin.pluginId, system.pluginId)),
				);
				assert(pinned?.configRevisionId);
				yield* plugins.persist(revisionPackage("fixture", "v2"), {
					ownerId: null,
					slug: "fixture",
					scope: "system",
				});
				const [unpinned] = yield* session.run((db) =>
					db
						.select({
							isExecutable: tables.globalPlugin.isExecutable,
							configRevisionId: tables.globalPlugin.configRevisionId,
						})
						.from(tables.globalPlugin)
						.where(eq(tables.globalPlugin.pluginId, system.pluginId)),
				);
				expect(unpinned).toEqual({ isExecutable: false, configRevisionId: null });
				expect((yield* userPlugin(system.pluginId))?.isExecutable).toBe(false);

				const exit = yield* Effect.exit(
					plugins.setEnvironmentConfigRevision(system.pluginId, pinned.configRevisionId),
				);
				expect(Exit.isFailure(exit)).toBe(true);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("upserts kernel definitions by slug and prunes removed rows", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const definitions = yield* DefinitionRepository;
				const source = kernelDefinitionSource();
				yield* seedKernelDefinitions(source);
				const kernelEntities = () =>
					session.run((db) =>
						db
							.select({
								id: tables.definitionEntitySchema.id,
								name: tables.definitionEntitySchema.name,
							})
							.from(tables.definitionEntitySchema)
							.where(isNull(tables.definitionEntitySchema.pluginRevisionId)),
					);
				const [seeded] = yield* kernelEntities();
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

				expect(yield* kernelEntities()).toEqual([{ id: seeded.id, name: "Renamed" }]);
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
		);
	});
});
