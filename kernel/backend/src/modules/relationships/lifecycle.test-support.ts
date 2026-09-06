import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Redacted, Ref } from "effect";
import { Client } from "pg";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { withLifecycleDispatch } from "#modules/automations/lifecycle.test-support";
import { LifecyclePlannerLive } from "#modules/automations/planner";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { DefinitionSource } from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { RelationshipMutationPipeline } from "./mutation-pipeline";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

export const userId = UserId.make("relationship-owner");
export const sourceEntityId = EntityId.make("relationship-source");
export const targetEntityId = EntityId.make("relationship-target");
export const relationshipSchemaSlug = RelationshipSchemaSlug.make("relationship-link");
export const propertiesSchema = {
	fields: {
		rank: { label: "Rank", type: "number", description: "Rank" },
		labels: {
			type: "array",
			label: "Labels",
			description: "Labels",
			items: { label: "Label", type: "string", description: "Label" },
		},
	},
} as const;
export const baseInput = {
	userId,
	sourceEntityId,
	targetEntityId,
	scope: "user" as const,
	relationshipSchemaSlug,
	properties: { rank: 1 },
};
export const command = (id: string) =>
	rootLifecycleCommand({
		source: "api",
		itemIdentity: "relationship",
		occurredAt: "2026-09-15T00:00:00.000Z",
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make(id),
	});

export class RelationshipFixture extends Context.Service<
	RelationshipFixture,
	{
		readonly observer: Client;
		readonly updateRelationshipSchema: Effect.Effect<void>;
		readonly disableRelationshipSchema: Effect.Effect<void>;
		readonly runLimitedPlanner: LifecyclePlanner["Service"];
	}
>()("test/RelationshipFixture") {}

export const relationshipsServiceWith = Effect.fnUntraced(function* (lifecycle: {
	readonly planner?: LifecyclePlanner["Service"];
	readonly execution?: LifecycleExecution["Service"];
}) {
	const planner = lifecycle.planner ?? (yield* LifecyclePlanner);
	const execution = lifecycle.execution ?? (yield* LifecycleExecution);
	const provideLifecycle = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		effect.pipe(
			Effect.provideService(LifecyclePlanner, planner),
			Effect.provideService(LifecycleExecution, execution),
		);
	const mutations = yield* provideLifecycle(RelationshipMutationPipeline.make);
	return yield* provideLifecycle(
		RelationshipsService.make.pipe(Effect.provideService(RelationshipMutationPipeline, mutations)),
	);
});

export const relationshipDatabaseLayer = (
	options: {
		readonly activateSchemaOnWrite?: boolean;
		readonly omitSchemaBeforeWrite?: boolean;
		readonly mutableRelationshipSchema?: boolean;
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const { url } = yield* IsolatedDatabase;
			const observer = yield* Effect.acquireRelease(
				Effect.gen(function* () {
					const client = new Client({ connectionString: url });
					yield* Effect.tryPromise(() => client.connect());
					return client;
				}),
				(client) => Effect.promise(() => client.end()),
			);
			const database = { url: Redacted.make(url) };
			const config = makeAppConfigLayer({ database });
			const relationshipSchema = {
				name: "Link",
				pluginId: null,
				propertiesSchema,
				slug: relationshipSchemaSlug,
				sourceEntitySchemaSlug: null,
				targetEntitySchemaSlug: null,
			};
			const source: DefinitionSource = {
				savedViews: [],
				signalSchemas: [],
				relationshipSchemas: [relationshipSchema],
				entitySchemas: [
					{
						name: "Fixture",
						icon: "fixture",
						pluginSlug: null,
						eventSchemas: [],
						slug: EntitySchemaSlug.make("fixture"),
						propertiesSchema: {
							fields: { title: { label: "Title", type: "string", description: "Title" } },
						},
					},
				],
			};
			const dependencies = Layer.mergeAll(
				PluginRepository.layer,
				PluginInstallationRepository.layer,
				PluginConfigRevisions.layer,
				PluginConfigEncryptionKey.layer,
				RelationshipsRepository.layer,
			);
			const schemaActivated = yield* Ref.make(false);
			const schemaState = yield* Ref.make<"active" | "disabled" | "updated">("active");
			const runtimeOnly =
				options.activateSchemaOnWrite ||
				options.omitSchemaBeforeWrite ||
				options.mutableRelationshipSchema
					? Layer.merge(
							Layer.mock(PluginRuntimeResolver)({
								lockCatalog: () => Ref.set(schemaActivated, options.activateSchemaOnWrite ?? false),
							}),
							Layer.mock(DefinitionRepository)({
								findUserRelationshipSchemas: (_userId, slugs) =>
									Effect.gen(function* () {
										const state = yield* Ref.get(schemaState);
										const activated = yield* Ref.get(schemaActivated);
										return options.omitSchemaBeforeWrite ||
											state === "disabled" ||
											!slugs.includes(relationshipSchemaSlug)
											? {}
											: {
													[relationshipSchemaSlug]:
														activated || state === "updated"
															? {
																	...relationshipSchema,
																	propertiesSchema: {
																		fields: {
																			...relationshipSchema.propertiesSchema.fields,
																			activated: {
																				label: "Activated",
																				type: "boolean" as const,
																				description: "Activated",
																			},
																		},
																	},
																}
															: relationshipSchema,
												};
									}),
							}),
						)
					: Layer.merge(
							PluginRuntimeResolver.layer.pipe(Layer.provide(dependencies)),
							DefinitionRepository.layer,
						);
			const runtime = Layer.merge(dependencies, runtimeOnly);
			const ownerDependencies = Layer.mergeAll(EntitiesRepository.layer, LifecyclePlannerLive).pipe(
				Layer.provideMerge(runtime),
				Layer.provideMerge(
					Layer.effect(
						LifecycleExecution,
						Effect.gen(function* () {
							const session = yield* DatabaseSession;
							const runs = yield* AutomationRunRepository.make;
							return withLifecycleDispatch(
								{
									after: () => Effect.succeed([]),
									skipQueuedPolicies: (input) => runs.skipQueuedPolicies(input),
									executePolicy: () => Effect.die("Unexpected policy in relationship fixture"),
								},
								session,
							);
						}),
					),
				),
			);
			const services = Layer.mergeAll(RelationshipsService.layer, EntitiesService.layer).pipe(
				Layer.provideMerge(RelationshipMutationPipeline.layer),
				Layer.provideMerge(ownerDependencies),
				Layer.provideMerge(DatabaseSession.layer),
				Layer.provideMerge(config),
			);
			const seed = Layer.effectDiscard(
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* (yield* DefinitionRepository.make).replaceKernelDefinitions(source);
					yield* session.run((db) =>
						Effect.gen(function* () {
							yield* db
								.insert(tables.user)
								.values({
									id: userId,
									name: "Owner",
									preferences: {},
									email: "relationship@example.test",
								});
							yield* db.insert(tables.entity).values([
								{ name: "Source", properties: {}, id: sourceEntityId, entitySchemaSlug: "fixture" },
								{ name: "Target", properties: {}, id: targetEntityId, entitySchemaSlug: "fixture" },
							]);
						}),
					);
				}),
			);
			const fixture = Layer.effect(
				RelationshipFixture,
				Effect.gen(function* () {
					return {
						observer,
						runLimitedPlanner: yield* LifecyclePlanner,
						updateRelationshipSchema: Ref.set(schemaState, "updated"),
						disableRelationshipSchema: Ref.set(schemaState, "disabled"),
					};
				}),
			).pipe(
				Layer.provide(
					Layer.fresh(LifecyclePlannerLive).pipe(
						Layer.provide(makeAppConfigLayer({ database, automations: { maxRuns: 1 } })),
					),
				),
			);
			return Layer.merge(seed, fixture).pipe(Layer.provideMerge(services));
		}),
	).pipe(
		Layer.provide(isolatedDatabaseLayer("relationship_test")),
		Layer.provideMerge(makeConfigProviderLayer()),
	);
