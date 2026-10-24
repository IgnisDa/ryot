import { assert, expect, layer } from "@effect/vitest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	PluginId,
} from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect, Exit, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import {
	relationshipDatabaseLayer,
	userId as owner,
} from "#modules/relationships/lifecycle.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeRedisService, makeWorkflowActivityEngine } from "#testing/effect";

import type { DomainLifecycleCommand } from "../write-context";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	ProviderEntityPopulationWorkflow,
	runProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";
import type { PopulationLevel } from "./schemas";

const bottle = EntitySchemaSlug.make("bottle");
const titleProperties = {
	fields: { title: { type: "string", label: "Title", description: "Title" } },
} as const;

const levelsPackage = () => {
	const source = revisionPackage("levels", "one", bottle, testPluginPackageId());
	return {
		...source,
		manifest: {
			...source.manifest,
			entitySchemas: ["bottle", "part"].map((slug) => ({
				slug,
				name: slug,
				icon: "box",
				eventSchemas: [],
				propertiesSchema: titleProperties,
			})),
			relationshipSchemas: [
				{
					name: "Parts",
					slug: "bottle-part",
					targetEntitySchemaSlug: "part",
					sourceEntitySchemaSlug: "bottle",
					propertiesSchema: { fields: {} },
				},
				{
					name: "Subparts",
					slug: "part-part",
					targetEntitySchemaSlug: "part",
					sourceEntitySchemaSlug: "part",
					propertiesSchema: { fields: {} },
				},
				{
					slug: "credits",
					name: "Credits",
					sourceEntitySchemaSlug: "bottle",
					targetEntitySchemaSlug: "bottle",
					propertiesSchema: { fields: {} },
				},
			],
		},
	};
};

const details = (input: {
	readonly title: string;
	readonly partTitle: string;
	readonly relationshipSchemaSlug?: string;
}) => ({
	name: "Bottle",
	properties: { title: input.title },
	expectedChildEntitySchemaSlug: "part",
	childEntities: [
		{
			name: "Part",
			externalId: "part",
			entitySchemaSlug: "part",
			properties: { title: input.partTitle },
		},
	],
	relatedEntityGroups: [
		{
			direction: "outgoing",
			synchronization: "authoritative",
			relationshipSchemaSlug: input.relationshipSchemaSlug ?? "credits",
			entities: [
				{
					name: "Related",
					externalId: "related",
					providerSlug: "levels-provider",
					properties: { title: "Related" },
				},
			],
		},
	],
});

const setup = Effect.gen(function* () {
	const installed = yield* installRevisionPackage(levelsPackage(), owner);
	const runtime = yield* PluginRuntimeResolver;
	const provider = yield* runtime.findProviderAvailableToUserByReference(owner, {
		slug: "levels-provider",
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(owner, provider.id);
	const subject = {
		userId: owner,
		type: "user" as const,
		accountGeneration: { userId: owner, token: "test-account-generation" },
	};
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
	const session = yield* DatabaseSession;

	const command = (executionId: string): DomainLifecycleCommand => ({
		...rootLifecycleCommand({
			source: "api",
			lane: "interactive",
			itemIdentity: executionId,
			occurredAt: "2026-10-23T00:00:00.000Z",
			initiator: { id: owner, kind: "user" },
			accountGeneration: subject.accountGeneration,
			executionId: AutomationExecutionId.make(executionId),
		}),
		writeContext: principal,
	});

	const populate = (input: {
		readonly executionId: string;
		readonly level: PopulationLevel;
		readonly mode?: "ensure" | "refresh";
		readonly details: Effect.Effect<unknown>;
	}) => {
		const instance = WorkflowInstance.initial(ProviderEntityPopulationWorkflow, input.executionId);
		return runProviderEntityPopulationWorkflow(
			{
				level: input.level,
				externalId: "root",
				providerId: provider.id,
				entitySchemaSlug: bottle,
				mode: input.mode ?? "ensure",
				executionId: input.executionId,
				command: command(input.executionId),
				pluginId: PluginId.make(installed.pluginId),
				entityScope: { type: "user", userId: owner },
			},
			input.executionId,
		).pipe(
			Effect.provideService(WorkflowInstance, instance),
			Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			Effect.provideService(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
			Effect.provideService(EntityImportWorkflowOperations, {
				processRelatedPage: () => Effect.die("unused"),
				completeProviderEntityImport: () => Effect.void,
				requireRelatedScript: () => Effect.die("unused"),
				processProviderResolve: () => Effect.die("unused"),
				preRegisterProviderImport: () => Effect.die("unused"),
				processSandbox: () =>
					Effect.map(input.details, (value) => ({
						value,
						logs: [],
						error: null,
						status: "completed" as const,
					})),
			}),
		);
	};

	const entity = (externalId: string) =>
		session
			.run((db) =>
				db
					.select()
					.from(tables.entity)
					.where(
						and(
							eq(tables.entity.userId, owner),
							eq(tables.entity.externalId, externalId),
							eq(tables.entity.entitySchemaPluginId, installed.pluginId),
						),
					),
			)
			.pipe(Effect.map(([row]) => row ?? null));

	const relationships = (slug: string) =>
		session.run((db) =>
			db
				.select()
				.from(tables.relationship)
				.where(
					and(
						eq(tables.relationship.userId, owner),
						eq(tables.relationship.relationshipSchemaSlug, slug),
						eq(tables.relationship.relationshipSchemaPluginId, installed.pluginId),
					),
				),
		);

	const seedUnpopulated = session.run((db) =>
		db
			.insert(tables.entity)
			.values({
				userId: owner,
				name: "Bottle",
				externalId: "root",
				providerId: provider.id,
				entitySchemaSlug: bottle,
				entitySchemaPluginId: installed.pluginId,
			}),
	);

	return { entity, populate, relationships, seedUnpopulated };
});

const given = (value: unknown) => Effect.succeed(value);

layer(relationshipDatabaseLayer())((test) => {
	test.effect(
		"keeps mixed-case provider siblings attached to their own subtrees and stamps new children",
		() =>
			Effect.gen(function* () {
				const { entity, populate, relationships } = yield* setup;
				const tree = {
					name: "Bottle",
					properties: { title: "Tree" },
					expectedChildEntitySchemaSlug: "part",
					childEntities: ["zeta", "Alpha", "alpha"].map((externalId) => ({
						externalId,
						name: externalId,
						entitySchemaSlug: "part",
						properties: { title: externalId },
						childEntities: [
							{
								entitySchemaSlug: "part",
								name: `${externalId} leaf`,
								externalId: `${externalId}-leaf`,
								properties: { title: `${externalId} leaf` },
							},
						],
					})),
				};
				yield* populate({ level: "base", details: given(tree), executionId: "tree-base" });
				const children = yield* Effect.forEach(tree.childEntities, (child) =>
					entity(child.externalId),
				);
				const leaves = yield* Effect.forEach(tree.childEntities, (child) =>
					entity(`${child.externalId}-leaf`),
				);
				const expectedEdges = children.map((child, index) => {
					const leaf = leaves[index];
					assert(child?.populatedAt && leaf?.populatedAt);
					expect(child.relatedPopulatedAt).toEqual(child.populatedAt);
					expect(leaf.relatedPopulatedAt).toEqual(leaf.populatedAt);
					return { targetEntityId: leaf.id, sourceEntityId: child.id };
				});
				expect(yield* relationships("part-part")).toEqual(
					expect.arrayContaining(expectedEdges.map((edge) => expect.objectContaining(edge))),
				);
				expect(yield* relationships("part-part")).toHaveLength(3);

				yield* populate({
					level: "full",
					mode: "refresh",
					executionId: "tree-refresh",
					details: given({
						...tree,
						childEntities: [
							...tree.childEntities.toReversed(),
							{
								name: "New",
								externalId: "new",
								entitySchemaSlug: "part",
								properties: { title: "New" },
							},
						],
					}),
				});
				const fresh = yield* entity("new");
				assert(fresh?.populatedAt);
				expect(fresh.relatedPopulatedAt).toEqual(fresh.populatedAt);
				expect(yield* relationships("part-part")).toEqual(
					expect.arrayContaining(expectedEdges.map((edge) => expect.objectContaining(edge))),
				);
				expect(yield* relationships("part-part")).toHaveLength(3);
				for (const child of children) {
					assert(child?.externalId);
					const refreshed = yield* entity(child.externalId);
					expect(refreshed?.id).toBe(child.id);
					expect(refreshed?.relatedPopulatedAt).toEqual(child.relatedPopulatedAt);
				}
			}),
	);
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect(
		"imports at base, then upgrades at full without clearing populated_at or refreshing children",
		() =>
			Effect.gen(function* () {
				const { entity, populate, relationships } = yield* setup;
				yield* populate({
					level: "base",
					executionId: "levels-base",
					details: given(details({ title: "Base", partTitle: "Base part" })),
				});
				const base = yield* entity("root");
				const basePart = yield* entity("part");
				assert(base?.populatedAt && basePart?.populatedAt);
				expect(base.relatedPopulatedAt).toBeNull();
				expect(basePart.relatedPopulatedAt).toEqual(basePart.populatedAt);
				expect(yield* relationships("credits")).toEqual([]);
				expect(yield* relationships("bottle-part")).toHaveLength(1);

				yield* populate({
					level: "base",
					executionId: "levels-base-again",
					details: Effect.die("a populated base entity must not run again"),
				});

				const populatedDuringUpgrade: Array<Date | null> = [];
				yield* populate({
					level: "full",
					executionId: "levels-full",
					details: entity("root").pipe(
						Effect.orDie,
						Effect.tap((row) =>
							Effect.sync(() => populatedDuringUpgrade.push(row?.populatedAt ?? null)),
						),
						Effect.as(details({ title: "Full", partTitle: "Changed part" })),
					),
				});

				const full = yield* entity("root");
				assert(full);
				expect(populatedDuringUpgrade).toEqual([base.populatedAt]);
				expect(full.populatedAt).not.toBeNull();
				expect(full.relatedPopulatedAt).toEqual(full.populatedAt);
				expect(full.properties).toEqual({ title: "Full" });
				expect((yield* entity("part"))?.properties).toEqual({ title: "Base part" });
				expect(yield* relationships("credits")).toHaveLength(1);

				yield* populate({
					level: "full",
					executionId: "levels-full-again",
					details: Effect.die("a fully populated entity must not run again"),
				});
			}),
	);
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect("keeps populated_at when a full upgrade fails after its root upsert", () =>
		Effect.gen(function* () {
			const { entity, populate, relationships } = yield* setup;
			yield* populate({
				level: "base",
				executionId: "levels-base",
				details: given(details({ title: "Base", partTitle: "Base part" })),
			});
			const base = yield* entity("root");
			assert(base?.populatedAt);

			const exit = yield* Effect.exit(
				populate({
					level: "full",
					executionId: "levels-failing-full",
					details: given(
						details({ title: "Full", partTitle: "Part", relationshipSchemaSlug: "missing" }),
					),
				}),
			);

			expect(Exit.isFailure(exit)).toBe(true);

			expect(yield* entity("root")).toMatchObject({
				populationFailure: null,
				relatedPopulatedAt: null,
				populatedAt: base.populatedAt,
				relatedPopulationFailure: null,
			});
			expect(yield* relationships("credits")).toEqual([]);
		}),
	);
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect(
		"keeps an overlapping base stamp through full runs that read the entity unpopulated and then fail",
		() =>
			Effect.gen(function* () {
				const { entity, populate, seedUnpopulated } = yield* setup;
				yield* seedUnpopulated;
				const populatedAt = entity("root").pipe(
					Effect.orDie,
					Effect.map((row) => row?.populatedAt ?? null),
				);
				const overlappingBase = populate({
					level: "base",
					executionId: "levels-overlap-base",
					details: given(details({ title: "Base", partTitle: "Base part" })),
				});
				const context = yield* Effect.context<Effect.Services<typeof overlappingBase>>();
				const observed: Array<Date | null> = [];
				const observe = Effect.flatMap(populatedAt, (value) =>
					Effect.sync(() => observed.push(value)),
				);
				const invalidFull = populate({
					level: "full",
					executionId: "levels-overlap-invalid-full",
					details: overlappingBase.pipe(
						Effect.provide(context),
						Effect.orDie,
						Effect.andThen(observe),
						Effect.as({ properties: {} }),
					),
				});

				const exit = yield* Effect.exit(
					populate({
						level: "full",
						executionId: "levels-overlap-full",
						details: Effect.exit(invalidFull.pipe(Effect.provide(context))).pipe(
							Effect.tap((invalidExit) =>
								Effect.sync(() => expect(Exit.isFailure(invalidExit)).toBe(true)),
							),
							Effect.andThen(observe),
							Effect.as(
								details({ title: "Full", partTitle: "Part", relationshipSchemaSlug: "missing" }),
							),
						),
					}),
				);

				expect(Exit.isFailure(exit)).toBe(true);
				yield* observe;
				expect(observed).toHaveLength(3);
				expect(observed.every((value) => value !== null)).toBe(true);
				expect(yield* entity("root")).toMatchObject({
					populationFailure: null,
					populationFailedAt: null,
					relatedPopulatedAt: null,
					relatedPopulationFailure: "invalid-output",
				});
			}),
	);
});
