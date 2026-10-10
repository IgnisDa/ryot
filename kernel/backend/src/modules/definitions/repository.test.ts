import { expect, layer } from "@effect/vitest";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { assert, describe } from "vitest";

import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

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
	return Object.values((yield* definitions.getUserSnapshot(owner, options)).entitySchemas)
		.map(({ slug }) => slug)
		.sort();
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
) => {
	const entity = packageValue.manifest.entitySchemas[0];
	assert(entity);
	const manifestEntitySlugs = new Set(packageValue.manifest.entitySchemas.map(({ slug }) => slug));
	const endpointSlugs = new Set(
		relationshipSchemas
			.flatMap(({ sourceEntitySchemaSlug, targetEntitySchemaSlug }) => [
				sourceEntitySchemaSlug,
				targetEntitySchemaSlug,
			])
			.filter((slug): slug is string => slug !== null),
	);
	const additionalEntitySchemas = Array.from(
		[...endpointSlugs].filter((slug) => !manifestEntitySlugs.has(slug)),
		(slug) => ({ ...entity, slug }),
	);

	return {
		...packageValue,
		manifest: {
			...packageValue.manifest,
			relationshipSchemas,
			entitySchemas: [...packageValue.manifest.entitySchemas, ...additionalEntitySchemas],
		},
	};
};

const withoutSignalAndSavedViewDefinitions = (packageValue: NormalizedPlugin) => ({
	...packageValue,
	manifest: { ...packageValue.manifest, hooks: [], savedViews: [], signalSchemas: [] },
});

describe("definition views", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("finds only requested owner-qualified global relationship schemas", () =>
			Effect.gen(function* () {
				const definitions = yield* DefinitionRepository;
				const kernel = kernelDefinitionSource();
				yield* seedKernelDefinitions({
					...kernel,
					relationshipSchemas: [
						{
							...relationshipSchema("kernel-pair", "shared-source", "shared-target"),
							pluginId: null,
						},
						{
							...relationshipSchema("kernel-other-target", "shared-source", "other-target"),
							pluginId: null,
						},
					],
				});
				const alpha = yield* installRevisionPackage(
					withRelationshipSchemas(
						revisionPackage("alpha", "v1", undefined, PluginPackageId.make("test/alpha")),
						[relationshipSchema("alpha-pair", "shared-source", "shared-target")],
					),
				);
				const beta = yield* installRevisionPackage(
					withRelationshipSchemas(
						revisionPackage("beta", "v1", undefined, PluginPackageId.make("test/beta")),
						[relationshipSchema("beta-pair", "shared-source", "shared-target")],
					),
				);

				const found = yield* definitions.findGlobalRelationshipSchemas([
					{ slug: "beta-pair", owner: definitionOwner(beta.pluginId) },
					{ slug: "kernel-other-target", owner: definitionOwner(null) },
					{ slug: "alpha-pair", owner: definitionOwner(alpha.pluginId) },
					{ slug: "beta-pair", owner: definitionOwner(alpha.pluginId) },
				]);
				expect(Object.keys(found)).toEqual([
					definitionKey("relationship", definitionOwner(alpha.pluginId), "alpha-pair"),
					definitionKey("relationship", definitionOwner(beta.pluginId), "beta-pair"),
					definitionKey("relationship", definitionOwner(null), "kernel-other-target"),
				]);
				expect(
					found[definitionKey("relationship", definitionOwner(alpha.pluginId), "alpha-pair")]
						?.pluginId,
				).toBe(alpha.pluginId);
				expect(
					found[definitionKey("relationship", definitionOwner(beta.pluginId), "beta-pair")]
						?.pluginId,
				).toBe(beta.pluginId);
				expect(
					found[definitionKey("relationship", definitionOwner(null), "kernel-other-target")]
						?.pluginId,
				).toBeNull();
				expect(
					yield* definitions.findGlobalRelationshipSchemas([
						{ slug: "not-found", owner: definitionOwner(null) },
					]),
				).toEqual({});
				expect(yield* definitions.findGlobalRelationshipSchemas([])).toEqual({});
			}),
		);

		test.effect("reads pinned relationship schemas in declaration order", () =>
			Effect.gen(function* () {
				const definitions = yield* DefinitionRepository;
				yield* seedKernelDefinitions();
				const installed = yield* installRevisionPackage(
					withRelationshipSchemas(
						revisionPackage("ordered", "v1", undefined, PluginPackageId.make("test/ordered")),
						[
							relationshipSchema("z-link", "shared-source", "shared-target"),
							relationshipSchema("a-link", "shared-source", "shared-target"),
						],
					),
				);
				const session = yield* DatabaseSession;
				for (const [from, to] of [
					["z-link", "z-link-moved"],
					["z-link-moved", "z-link"],
				] as const) {
					yield* session.run((db) =>
						db
							.update(tables.definitionRelationshipSchema)
							.set({ slug: to })
							.where(
								and(
									eq(tables.definitionRelationshipSchema.pluginRevisionId, installed.revisionId),
									eq(tables.definitionRelationshipSchema.slug, from),
								),
							),
					);
				}

				const snapshot = yield* definitions.getSnapshotForContext(
					{
						pluginId: PluginId.make(installed.pluginId),
						pluginRevisionId: PluginRevisionId.make(installed.revisionId),
					},
					owner,
				);
				expect(
					Object.values(snapshot.relationshipSchemas)
						.filter(({ pluginId }) => pluginId === installed.pluginId)
						.map(({ slug }) => slug),
				).toEqual(["z-link", "a-link"]);
			}),
		);

		test.effect("round-trips relationship user write policy through revision and definitions", () =>
			Effect.gen(function* () {
				const definitions = yield* DefinitionRepository;
				yield* seedKernelDefinitions();
				const installed = yield* installRevisionPackage(
					withRelationshipSchemas(
						revisionPackage("policy", "v1", "policy-entity", PluginPackageId.make("test/policy")),
						[
							{
								...relationshipSchema("policy-link", "policy-entity", "policy-entity"),
								userWritePolicy: "source-owner",
							},
							relationshipSchema("annotation-link", "policy-entity", "policy-entity"),
						],
					),
				);
				const relationshipKey = definitionKey(
					"relationship",
					definitionOwner(installed.pluginId),
					"policy-link",
				);
				const annotationRelationshipKey = definitionKey(
					"relationship",
					definitionOwner(installed.pluginId),
					"annotation-link",
				);

				const revisionDeclaration = yield* definitions.findRevisionDeclaration({
					slug: "policy-link",
					kind: "relationship",
					revisionId: installed.revisionId,
				});
				expect(revisionDeclaration?.userWritePolicy).toBe("source-owner");
				const annotationRevisionDeclaration = yield* definitions.findRevisionDeclaration({
					kind: "relationship",
					slug: "annotation-link",
					revisionId: installed.revisionId,
				});
				assert(annotationRevisionDeclaration);
				expect(annotationRevisionDeclaration).not.toHaveProperty("userWritePolicy");

				const session = yield* DatabaseSession;
				const [annotationRow] = yield* session.run((db) =>
					db
						.select({ userWritePolicy: tables.definitionRelationshipSchema.userWritePolicy })
						.from(tables.definitionRelationshipSchema)
						.where(
							and(
								eq(tables.definitionRelationshipSchema.pluginRevisionId, installed.revisionId),
								eq(tables.definitionRelationshipSchema.slug, "annotation-link"),
							),
						),
				);
				expect(annotationRow?.userWritePolicy).toBeNull();

				const globalSnapshot = yield* definitions.getGlobalSnapshot;
				const userSnapshot = yield* definitions.getUserSnapshot(owner, effective);
				const pinnedSnapshot = yield* definitions.getSnapshotForContext(
					{
						pluginId: PluginId.make(installed.pluginId),
						pluginRevisionId: PluginRevisionId.make(installed.revisionId),
					},
					owner,
				);
				for (const snapshot of [globalSnapshot, userSnapshot, pinnedSnapshot]) {
					expect(snapshot.relationshipSchemas[relationshipKey]?.userWritePolicy).toBe(
						"source-owner",
					);
					const annotationRelationship = snapshot.relationshipSchemas[annotationRelationshipKey];
					assert(annotationRelationship);
					expect(annotationRelationship).not.toHaveProperty("userWritePolicy");
				}
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
						[definitionKey("entity", definitionOwner(null), "collection")]: {
							pluginId: null,
							slug: "collection",
						},
						[definitionKey("entity", definitionOwner(system.pluginId), "system-entity")]: {
							slug: "system-entity",
							pluginId: system.pluginId,
						},
					});
					expect(Object.values(globalDefinitions.entitySchemas).map(({ slug }) => slug)).toEqual([
						"collection",
						"system-entity",
					]);
					expect(globalDefinitions.entitySchemas).toEqual(
						Object.fromEntries(
							Object.values(globalSnapshot.entitySchemas).map(({ slug, pluginId }) => [
								definitionKey("entity", definitionOwner(pluginId), slug),
								{ slug, pluginId },
							]),
						),
					);
					expect(globalSnapshot.savedViews).toEqual({});
					expect(globalSnapshot.signalSchemas).toEqual({});
					expect(globalDefinitions.relationshipSchemas).toEqual(globalSnapshot.relationshipSchemas);
					expect(
						globalDefinitions.relationshipSchemas[
							definitionKey("relationship", definitionOwner(null), "member-of")
						]?.pluginId,
					).toBeNull();
					expect(
						globalDefinitions.relationshipSchemas[
							definitionKey("relationship", definitionOwner(system.pluginId), "system-link")
						]?.pluginId,
					).toBe(system.pluginId);
					expect(
						Object.values(globalDefinitions.relationshipSchemas).map(({ slug }) => slug),
					).toEqual(["system-link", "member-of"]);

					const userDefinitions = yield* definitions.getUserEntityRelationshipDefinitions(owner);
					const userSnapshot = yield* definitions.getUserSnapshot(owner, effective);
					expect(userDefinitions.entitySchemas).toEqual({
						[definitionKey("entity", definitionOwner(null), "collection")]: {
							pluginId: null,
							slug: "collection",
						},
						[definitionKey("entity", definitionOwner(system.pluginId), "system-entity")]: {
							slug: "system-entity",
							pluginId: system.pluginId,
						},
						[definitionKey("entity", definitionOwner(privatePlugin.pluginId), "private-entity")]: {
							slug: "private-entity",
							pluginId: privatePlugin.pluginId,
						},
					});
					expect(Object.values(userDefinitions.entitySchemas).map(({ slug }) => slug)).toEqual([
						"collection",
						"system-entity",
						"private-entity",
					]);
					expect(userDefinitions.entitySchemas).toEqual(
						Object.fromEntries(
							Object.values(userSnapshot.entitySchemas).map(({ slug, pluginId }) => [
								definitionKey("entity", definitionOwner(pluginId), slug),
								{ slug, pluginId },
							]),
						),
					);
					expect(userSnapshot.savedViews).toEqual({});
					expect(userSnapshot.signalSchemas).toEqual({});
					expect(userDefinitions.relationshipSchemas).toEqual(userSnapshot.relationshipSchemas);
					expect(
						userDefinitions.relationshipSchemas[
							definitionKey("relationship", definitionOwner(null), "member-of")
						]?.pluginId,
					).toBeNull();
					expect(
						userDefinitions.relationshipSchemas[
							definitionKey("relationship", definitionOwner(system.pluginId), "system-link")
						]?.pluginId,
					).toBe(system.pluginId);
					expect(
						userDefinitions.relationshipSchemas[
							definitionKey("relationship", definitionOwner(privatePlugin.pluginId), "private-link")
						]?.pluginId,
					).toBe(privatePlugin.pluginId);
					expect(
						Object.values(userDefinitions.relationshipSchemas).map(({ slug }) => slug),
					).toEqual(["private-link", "system-link", "member-of"]);
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
							{
								...relationshipSchema("kernel-pair", "shared-source", "shared-target"),
								pluginId: null,
							},
							{
								...relationshipSchema("kernel-other-target", "shared-source", "other-target"),
								pluginId: null,
							},
						],
					});
					const alpha = yield* installRevisionPackage(
						withRelationshipSchemas(
							revisionPackage("alpha", "v1", undefined, PluginPackageId.make("test/alpha")),
							[relationshipSchema("alpha-pair", "shared-source", "shared-target")],
						),
					);
					yield* installRevisionPackage(
						withRelationshipSchemas(
							revisionPackage("beta", "v1", undefined, PluginPackageId.make("test/beta")),
							[relationshipSchema("beta-pair", "shared-source", "shared-target")],
						),
					);

					expect(
						yield* definitions.findGlobalRelationshipSchemaByEndpoints(
							definitionOwner(alpha.pluginId),
							"shared-source",
							"shared-target",
						),
					).toMatchObject({ slug: "alpha-pair", pluginId: alpha.pluginId });
					expect(
						yield* definitions.findGlobalRelationshipSchemaByEndpoints(
							definitionOwner(null),
							"shared-source",
							"other-target",
						),
					).toMatchObject({ pluginId: null, slug: "kernel-other-target" });
					expect(
						yield* definitions.findGlobalRelationshipSchemaByEndpoints(
							definitionOwner(alpha.pluginId),
							"shared-source",
							"missing-target",
						),
					).toBeNull();
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("keeps same-named private definitions independent from the global system set", () =>
			Effect.gen(function* () {
				const definitions = yield* DefinitionRepository;
				yield* seedKernelDefinitions();
				const system = yield* installRevisionPackage(revisionPackage());
				const privatePlugin = yield* installRevisionPackage(
					revisionPackage("private", "v1", "fixture-entity"),
					owner,
				);

				const snapshot = yield* definitions.getUserSnapshot(owner, effective);
				expect(
					snapshot.entitySchemas[
						definitionKey("entity", definitionOwner(system.pluginId), "fixture-entity")
					]?.pluginId,
				).toBe(system.pluginId);
				expect(
					snapshot.entitySchemas[
						definitionKey("entity", definitionOwner(privatePlugin.pluginId), "fixture-entity")
					]?.pluginId,
				).toBe(privatePlugin.pluginId);
				expect(Object.values(snapshot.relationshipSchemas).map(({ slug }) => slug)).toEqual([
					"private-link",
					"fixture-link",
					"member-of",
				]);

				yield* setInstallation(system.installation.id, { isHidden: true });
				const hidden = yield* definitions.getUserSnapshot(owner, effective);
				expect(
					hidden.entitySchemas[
						definitionKey("entity", definitionOwner(system.pluginId), "fixture-entity")
					],
				).toBeUndefined();
				expect(
					hidden.entitySchemas[
						definitionKey("entity", definitionOwner(privatePlugin.pluginId), "fixture-entity")
					],
				).toBeDefined();
				expect(
					hidden.relationshipSchemas[
						definitionKey("relationship", definitionOwner(privatePlugin.pluginId), "private-link")
					],
				).toBeDefined();
				expect(
					hidden.entitySchemas[definitionKey("entity", definitionOwner(null), "collection")],
				).toBeDefined();
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
					definitions.getUserSnapshot(owner, options).pipe(
						Effect.map((snapshot) =>
							Object.values(snapshot.relationshipSchemas)
								.map(({ slug }) => slug)
								.sort(),
						),
					);
				expect(yield* relationshipSlugs(listed)).toEqual(["alpha-link"]);
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
				const systemPackage = revisionPackage();
				const privatePackage = revisionPackage("alpha");
				const system = yield* installRevisionPackage(systemPackage);
				const alpha = yield* installRevisionPackage(privatePackage, owner);
				expect((yield* userPlugin(system.pluginId))?.isExecutable).toBe(true);
				expect((yield* userPlugin(alpha.pluginId))?.isExecutable).toBe(true);

				yield* session.transaction(
					Effect.gen(function* () {
						yield* plugins.lockIngestion();
						yield* plugins.persist(
							revisionPackage(
								"alpha",
								"v2",
								"alpha-entity",
								privatePackage.manifest.metadata.packageId,
							),
							{ scope: "user", ownerId: owner, pluginId: PluginId.make(alpha.pluginId) },
						);
					}),
				);
				expect((yield* userPlugin(alpha.pluginId))?.isExecutable).toBe(false);

				const [pinned] = yield* session.run((db) =>
					db
						.select({ configRevisionId: tables.globalPlugin.configRevisionId })
						.from(tables.globalPlugin)
						.where(eq(tables.globalPlugin.pluginId, system.pluginId)),
				);
				assert(pinned?.configRevisionId);
				yield* session.transaction(
					Effect.gen(function* () {
						yield* plugins.lockIngestion();
						yield* plugins.persist(
							revisionPackage(
								"fixture",
								"v2",
								"fixture-entity",
								systemPackage.manifest.metadata.packageId,
							),
							{ ownerId: null, scope: "system", pluginId: PluginId.make(system.pluginId) },
						);
					}),
				);
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
				expect(
					Object.keys(
						snapshot.entitySchemas[definitionKey("entity", definitionOwner(null), "collection")]
							?.eventSchemas ?? {},
					),
				).toEqual(["add-entity-to-collection", "remove-entity-from-collection"]);
				expect(yield* definitions.readKernelSource).toMatchObject({
					relationshipSchemas: [],
					savedViews: [
						{ pluginId: null, slug: "collections" },
						{ pluginId: null, slug: "calendar" },
					],
				});
			}),
		);
	});
});

const integration = (slug: string) => ({
	slug,
	name: slug,
	description: slug,
	settingsSchema: { fields: {} },
});

describe("integration provider plans", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("stores each declared plan and none for push or planless providers", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const value = revisionPackage("integrations");
				const executableDependencies = [
					{
						kind: "workflow" as const,
						slug: "integrations-flow",
						selection: { key: "remote", id: "collector", stage: "settings" as const },
					},
				];
				yield* installRevisionPackage({
					...value,
					scripts: value.scripts.map((script) =>
						script.slug === "integrations.task"
							? Object.assign({}, script, {
									metadata: Object.assign({}, script.metadata, { executableDependencies }),
								})
							: script,
					),
					manifest: {
						...value.manifest,
						scripts: value.manifest.scripts.map((script) =>
							script.slug === "integrations.task"
								? Object.assign({}, script, { executableDependencies })
								: script,
						),
						integrationProviders: [
							{
								...integration("with-plan"),
								lot: "yank",
								scriptSlug: "integrations.task",
								plan: { selections: { collector: { value: "remote" } } },
							},
							{ ...integration("without-plan"), lot: "sink", scriptSlug: "integrations.workflow" },
							{ ...integration("push"), lot: "push" },
						],
					},
				});
				const rows = yield* session.run((db) =>
					db
						.select({
							slug: tables.userIntegrationProvider.slug,
							plan: tables.userIntegrationProvider.plan,
						})
						.from(tables.userIntegrationProvider)
						.where(eq(tables.userIntegrationProvider.userId, owner)),
				);
				expect(rows.sort((left, right) => (left.slug < right.slug ? -1 : 1))).toEqual([
					{ plan: null, slug: "data-json" },
					{ plan: null, slug: "push" },
					{ slug: "with-plan", plan: { selections: { collector: { value: "remote" } } } },
					{ plan: null, slug: "without-plan" },
				]);
			}),
		);
	});
});
