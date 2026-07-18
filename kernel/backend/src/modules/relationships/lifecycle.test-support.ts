import { PgClient } from "@effect/sql-pg";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Redacted } from "effect";
import { Client } from "pg";
import { assert } from "vitest";

import type { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import type { AppConfig } from "#lib/infrastructure/config/service";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { PluginEnvironmentConfig } from "#lib/infrastructure/plugin-environment-config";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { withLifecycleDispatch } from "#modules/automations/lifecycle.test-support";
import { LifecyclePlannerLive } from "#modules/automations/planner";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

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

type Services =
	| Database
	| PgClient.PgClient
	| RelationshipsService
	| EntitiesService
	| RelationshipsRepository
	| EntitiesRepository
	| PluginRuntimeResolver
	| DefinitionRegistry
	| LifecyclePlanner
	| LifecycleExecution
	| PluginRepository
	| PluginInstallationRepository
	| PluginLoader
	| PluginConfigRevisions
	| PluginConfigEncryptionKey
	| PluginEnvironmentConfig
	| AppConfig;

export const withRelationshipDatabase = <E>(
	test: (
		observer: Client,
		catalog: { disableRelationshipSchema: () => void; updateRelationshipSchema: () => void },
	) => Effect.Effect<void, E, Services>,
	options: {
		readonly activateSchemaOnWrite?: boolean;
		readonly omitSchemaBeforeWrite?: boolean;
		readonly mutableRelationshipSchema?: boolean;
	} = {},
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const url = testDatabaseUrl();
			const name = `relationship_test_${crypto.randomUUID().replaceAll("-", "")}`;
			const admin = yield* Effect.acquireRelease(
				Effect.gen(function* () {
					const client = new Client({ connectionString: url });
					yield* Effect.tryPromise(() => client.connect());
					return client;
				}),
				(client) =>
					Effect.promise(() => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).pipe(
						Effect.andThen(Effect.promise(() => client.end())),
					),
			);
			yield* Effect.tryPromise(() => admin.query(`CREATE DATABASE "${name}"`));
			const scopedUrl = new URL(url);
			scopedUrl.pathname = `/${name}`;
			const observer = yield* Effect.acquireRelease(
				Effect.gen(function* () {
					const client = new Client({ connectionString: scopedUrl.toString() });
					yield* Effect.tryPromise(() => client.connect());
					return client;
				}),
				(client) => Effect.promise(() => client.end()),
			);
			yield* Effect.gen(function* () {
				const directory = new URL("../../drizzle/", import.meta.url).pathname;
				const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
				assert(paths.length === 1);
				const ddl = yield* Effect.tryPromise(() => Bun.file(directory + paths[0]).text());
				for (const statement of ddl.split("--> statement-breakpoint")) {
					yield* Effect.tryPromise(() => observer.query(statement));
				}
			});
			const config = makeAppConfigLayer({ database: { url: Redacted.make(scopedUrl.toString()) } });
			const registry = makeDefinitionRegistry({
				savedViews: [],
				signalSchemas: [],
				relationshipSchemas: [
					{
						name: "Link",
						propertiesSchema,
						slug: relationshipSchemaSlug,
						sourceEntitySchemaSlug: null,
						targetEntitySchemaSlug: null,
					},
				],
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
			});
			const dependencies = Layer.mergeAll(
				PluginRepository.layer,
				PluginInstallationRepository.layer,
				PluginConfigRevisions.layer,
				PluginConfigEncryptionKey.layer,
				RelationshipsRepository.layer,
				Layer.succeed(DefinitionRegistry, registry),
				Layer.succeed(PluginLoader, makePluginLoader(registry)),
			).pipe(Layer.provideMerge(PluginEnvironmentConfig.layer));
			let schemaActivated = false;
			let schemaState: "active" | "disabled" | "updated" = "active";
			const runtimeOnly =
				options.activateSchemaOnWrite ||
				options.omitSchemaBeforeWrite ||
				options.mutableRelationshipSchema
					? Layer.mock(PluginRuntimeResolver)({
							lockCatalog: () =>
								Effect.sync(() => {
									schemaActivated = options.activateSchemaOnWrite ?? false;
								}),
							getEffectiveDefinitions: () => {
								const snapshot = registry.getSnapshot();
								const definition = snapshot.relationshipSchemas[relationshipSchemaSlug];
								assert(definition);
								if (options.omitSchemaBeforeWrite || schemaState === "disabled") {
									return Effect.succeed({ ...snapshot, relationshipSchemas: {} });
								}
								return Effect.succeed({
									...snapshot,
									relationshipSchemas: {
										...snapshot.relationshipSchemas,
										[relationshipSchemaSlug]:
											schemaActivated || schemaState === "updated"
												? {
														...definition,
														propertiesSchema: {
															fields: {
																...definition.propertiesSchema.fields,
																activated: {
																	label: "Activated",
																	type: "boolean" as const,
																	description: "Activated",
																},
															},
														},
													}
												: definition,
									},
								});
							},
						})
					: PluginRuntimeResolver.layer.pipe(Layer.provide(dependencies));
			const runtime = Layer.merge(dependencies, runtimeOnly);
			const ownerDependencies = Layer.mergeAll(EntitiesRepository.layer, LifecyclePlannerLive).pipe(
				Layer.provideMerge(runtime),
				Layer.provideMerge(
					Layer.effect(
						LifecycleExecution,
						Effect.gen(function* () {
							const database = yield* Database;
							const client = yield* PgClient.PgClient;
							const runs = yield* AutomationRunRepository.make;
							return withLifecycleDispatch(
								{
									after: () => Effect.succeed([]),
									executePolicy: () => Effect.die("Unexpected policy in relationship fixture"),
									skipQueuedPolicies: (input) =>
										runs.skipQueuedPolicies(input).pipe(Effect.provideService(Database, database)),
								},
								client,
							);
						}),
					),
				),
			);
			const services = Layer.mergeAll(RelationshipsService.layer, EntitiesService.layer).pipe(
				Layer.provideMerge(ownerDependencies),
				Layer.provideMerge(DatabaseLive),
				Layer.provideMerge(config),
			);
			yield* Effect.gen(function* () {
				const db = yield* Database;
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
				yield* test(observer, {
					updateRelationshipSchema: () => {
						schemaState = "updated";
					},
					disableRelationshipSchema: () => {
						schemaState = "disabled";
					},
				});
			}).pipe(Effect.provide(services));
		}),
	).pipe(Effect.provide(makeConfigProviderLayer()));
