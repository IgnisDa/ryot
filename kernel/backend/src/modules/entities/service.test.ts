import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationBlockedReason,
	AutomationPolicyOutput,
	AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Layer, Option, Redacted } from "effect";
import { assert, describe } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { PluginEnvironmentConfig } from "#lib/infrastructure/plugin-environment-config";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntitiesRepository } from "./repository";
import { EntitiesService } from "./service";

const owner = UserId.make("owner");
const slug = EntitySchemaSlug.make("record");
const command = (id: string) =>
	rootLifecycleCommand({
		source: "api",
		itemIdentity: "entity",
		initiator: { id: owner, kind: "user" },
		executionId: AutomationExecutionId.make(id),
		occurredAt: IsoUtcString.make("2026-09-15T00:00:00.000Z"),
	});
const createInput = (id: string) => ({
	userId: owner,
	name: " Original ",
	lifecycle: command(id),
	entitySchemaSlug: slug,
	scope: "user" as const,
	properties: { title: "original" },
});
const warning: AutomationWarning = {
	code: "required-hook-failed",
	runId: AutomationRunId.make("after-run"),
	hookSlug: AutomationHookSlug.make("fixture.after"),
};
type TestOptions = {
	blocked?: boolean;
	blockedRequiredChange?: boolean;
	activateSchemaOnWrite?: boolean;
	failChange?: boolean | number;
	warnings?: ReadonlyArray<AutomationWarning>;
	policies?: ReadonlyArray<AutomationPolicyOutput | "fail">;
	policyCalls?: string[];
	skippedPolicyTriggers?: string[];
};

const withEntities = <E>(
	test: Effect.Effect<
		void,
		E,
		EntitiesService | EntitiesRepository | Database | AutomationTriggerRepository
	>,
	options: TestOptions = {},
) => {
	const name = `entity_test_${crypto.randomUUID().replaceAll("-", "")}`;
	let changePlans = 0;
	let schemaActivated = false;
	const registry = makeDefinitionRegistry({
		savedViews: [],
		signalSchemas: [],
		relationshipSchemas: [],
		entitySchemas: [
			{
				slug,
				name: "Record",
				icon: "record",
				pluginSlug: null,
				eventSchemas: [],
				propertiesSchema: {
					fields: {
						title: { type: "string", label: "Title", description: "Title" },
						score: {
							type: "number",
							label: "Score",
							description: "Score",
							normalize: { round: { scale: 2 } },
						},
					},
				},
			},
		],
	});
	const base = Layer.mergeAll(
		Layer.succeed(DefinitionRegistry, registry),
		Layer.succeed(PluginLoader, makePluginLoader(registry)),
		PluginRepository.layer,
		PluginInstallationRepository.layer,
		PluginConfigRevisions.layer,
		PluginConfigEncryptionKey.layer,
	).pipe(Layer.provideMerge(PluginEnvironmentConfig.layer));
	const runtime = options.activateSchemaOnWrite
		? Layer.mock(PluginRuntimeResolver)({
				lockCatalog: () =>
					Effect.sync(() => {
						schemaActivated = true;
					}),
				getEffectiveDefinitions: () => {
					const snapshot = registry.getSnapshot();
					const definition = snapshot.entitySchemas[slug];
					assert(definition);
					return Effect.succeed({
						...snapshot,
						entitySchemas: {
							...snapshot.entitySchemas,
							[slug]: schemaActivated
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
		: PluginRuntimeResolver.layer.pipe(Layer.provide(base));
	const repositories = Layer.mergeAll(
		EntitiesRepository.layer.pipe(Layer.provide(Layer.merge(base, runtime))),
		AutomationTriggerRepository.layer,
	);
	const ports = Layer.effect(
		LifecyclePlanner,
		Effect.gen(function* () {
			const triggers = yield* AutomationTriggerRepository;
			const client = yield* PgClient.PgClient;
			return LifecyclePlanner.of({
				plan: ({ trigger }) =>
					Effect.gen(function* () {
						expect(Option.isSome(yield* Effect.serviceOption(client.transactionService))).toBe(
							true,
						);
						let blockedReason: AutomationBlockedReason | null = null;
						if (trigger.kind.category === "request" && options.blocked) {
							blockedReason = {
								omittedHooks: [],
								hasRequiredHooks: false,
								code: "automation-limit-reached",
							};
						} else if (trigger.kind.category === "change" && options.blockedRequiredChange) {
							blockedReason = {
								omittedHooks: [],
								hasRequiredHooks: true,
								code: "automation-limit-reached",
							};
						}
						const persisted = yield* triggers.insert({ ...trigger, blockedReason });
						if (trigger.kind.category === "change") {
							changePlans += 1;
						}
						if (
							trigger.kind.category === "change" &&
							(options.failChange === true || options.failChange === changePlans)
						) {
							return yield* new DbError({ message: "Injected planning failure after insert" });
						}
						return {
							runs: [],
							wasCreated: true,
							trigger: persisted,
							policies:
								trigger.kind.category === "request"
									? (options.policies ?? []).map((_, index) => ({
											position: index,
											runId: AutomationRunId.make(`policy-${index}`),
										}))
									: [],
						};
					}),
			});
		}),
	).pipe(Layer.provide(repositories));
	const execution = Layer.effect(
		LifecycleExecution,
		Effect.gen(function* () {
			const client = yield* PgClient.PgClient;
			const db = yield* Database;
			return LifecycleExecution.of({
				skipQueuedPolicies: ({ triggerId }) =>
					Effect.sync(() => {
						options.skippedPolicyTriggers?.push(triggerId);
					}),
				after: ({ triggerId }) =>
					Effect.gen(function* () {
						expect(Option.isNone(yield* Effect.serviceOption(client.transactionService))).toBe(
							true,
						);
						const [trigger] = yield* db
							.select()
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.id, triggerId));
						assert(trigger);
						expect(trigger.category).toBe("change");
						return options.warnings ?? [];
					}).pipe(Effect.mapError((error) => new DbError({ message: String(error) }))),
				executePolicy: ({ runId, payload }) =>
					Effect.gen(function* () {
						options.policyCalls?.push(runId);
						expect(Option.isNone(yield* Effect.serviceOption(client.transactionService))).toBe(
							true,
						);
						const requests = yield* db
							.select()
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.category, "request"))
							.pipe(Effect.orDie);
						expect(requests.length).toBeGreaterThan(0);
						const index = Number(runId.split("-")[1]);
						if (index === 1) {
							expect(payload.draft).toMatchObject({ name: "First" });
						}
						const output = options.policies?.[index];
						assert(output);
						if (output === "fail") {
							return yield* new AutomationPolicyExecutionError({
								runId,
								code: "policy-execution-failed",
							});
						}
						return output;
					}),
			});
		}),
	);
	const services = Layer.mergeAll(
		repositories,
		EntitiesService.layer.pipe(Layer.provide(Layer.mergeAll(repositories, ports, execution))),
	).pipe(
		Layer.provideMerge(DatabaseLive),
		Layer.provide(
			makeAppConfigLayer({ database: { poolMax: 1, url: Redacted.make(testDatabaseUrl()) } }),
		),
	);
	return Effect.gen(function* () {
		const db = yield* Database;
		const directory = new URL("../../drizzle/", import.meta.url).pathname;
		const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
		assert(paths.length === 1);
		const ddl = yield* Effect.promise(() => Bun.file(directory + paths[0]).text());
		yield* Effect.acquireUseRelease(
			db.execute(sql`create schema ${sql.identifier(name)}`),
			() =>
				Effect.gen(function* () {
					yield* db.execute(sql`set search_path to ${sql.identifier(name)}, public`);
					for (const statement of ddl.split("--> statement-breakpoint")) {
						yield* db.execute(sql.raw(statement));
					}
					yield* db
						.insert(tables.user)
						.values({ id: owner, name: "Owner", preferences: {}, email: "owner@example.test" });
					yield* test;
				}),
			() => db.execute(sql`drop schema ${sql.identifier(name)} cascade`).pipe(Effect.orDie),
		);
	}).pipe(Effect.provide(services.pipe(Layer.provideMerge(makeConfigProviderLayer()))));
};

describe("EntitiesService committed lifecycle", () => {
	it.effect("normalizes numeric properties before persisting the entity and change snapshot", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const db = yield* Database;
				const result = yield* service.create({
					...createInput("normalized"),
					properties: { score: 25.555, title: "numeric" },
				});
				expect(result.entity.properties).toEqual({ score: 25.56, title: "numeric" });
				const changes = (yield* db.select().from(tables.automationTrigger)).find(
					(row) => row.category === "change",
				);
				expect(changes?.payload).toMatchObject({
					after: { properties: { score: 25.56, title: "numeric" } },
				});
			}),
		),
	);

	it.effect("returns blocked required-hook warnings for normal create, update, and delete", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const created = yield* service.create(createInput("limited-create"));
				expect(created.warnings).toEqual([
					expect.objectContaining({ hasRequiredHooks: true, code: "automation-limit-reached" }),
				]);
				const updated = yield* service.update({
					userId: owner,
					scope: "user",
					name: "Updated",
					populatedAt: null,
					entityId: created.entity.id,
					properties: { title: "updated" },
					lifecycle: command("limited-update"),
				});
				expect(updated.warnings).toEqual([
					expect.objectContaining({ hasRequiredHooks: true, code: "automation-limit-reached" }),
				]);
				const deleted = yield* service.deleteByIds([created.entity.id], command("limited-delete"));
				expect(deleted.warnings).toEqual([
					expect.objectContaining({ hasRequiredHooks: true, code: "automation-limit-reached" }),
				]);
			}),
			{ blockedRequiredChange: true },
		),
	);

	it.effect("revalidates the entity schema under the catalog lock before writing", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const db = yield* Database;
				expect(yield* service.create(createInput("schema-race")).pipe(Effect.flip)).toMatchObject({
					reason: { code: "mutation-conflict" },
				});
				expect(yield* db.select().from(tables.entity)).toEqual([]);
			}),
			{ activateSchemaOnWrite: true },
		),
	);

	it.effect(
		"rejects invalid names, missing schemas, incomplete provenance and invalid bulk limits before planning",
		() =>
			withEntities(
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const db = yield* Database;
					expect(
						yield* service.create({ ...createInput("name"), name: "   " }).pipe(Effect.flip),
					).toMatchObject({ reason: { code: "name-required" } });
					expect(
						yield* service
							.create({
								...createInput("missing"),
								entitySchemaSlug: EntitySchemaSlug.make("missing"),
							})
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "entity-schema-not-found" } });
					expect(
						yield* service
							.create({ ...createInput("provenance"), externalId: "incomplete" })
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "incomplete-provenance" } });
					expect(
						yield* service
							.upsertGlobalEntities([], providerId, command("limit"), { maximumTotal: -1 })
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "invalid-maximum-total" } });
					expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
				}),
			),
	);
	it.effect("rolls all bulk rows and change plans back when the second plan fails", () =>
		withEntities(
			Effect.gen(function* () {
				yield* seedProvider;
				const service = yield* EntitiesService;
				const db = yield* Database;
				const items = ["one", "two"].map((externalId) => ({
					externalId,
					name: externalId,
					populatedAt: null,
					entitySchemaSlug: slug,
					properties: { title: externalId },
				}));
				expect(
					yield* service
						.upsertGlobalEntities(items, providerId, command("bulk-rollback"))
						.pipe(Effect.flip),
				).toMatchObject({ _tag: "DbError" });
				expect(yield* db.select().from(tables.entity)).toEqual([]);
				expect(
					(yield* db.select().from(tables.automationTrigger)).map((row) => row.category),
				).toEqual(["request", "request"]);
			}),
			{ failChange: 2 },
		),
	);
	it.effect("rolls a delete back with its change plan", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const db = yield* Database;
				const created = yield* service.create(createInput("before-delete"));
				expect(
					yield* service
						.deleteByIds([created.entity.id], command("delete-rollback"))
						.pipe(Effect.flip),
				).toMatchObject({ _tag: "DbError" });
				expect(yield* service.getByIdAnyScope(created.entity.id)).toEqual(created.entity);
				expect(
					(yield* db.select().from(tables.automationTrigger))
						.filter((row) => row.category === "change")
						.map((row) => row.operation),
				).toEqual(["create"]);
			}),
			{ failChange: 2 },
		),
	);
	const providerId = SandboxProviderId.make("fixture-provider");
	const seedProvider = Effect.gen(function* () {
		const db = yield* Database;
		yield* db
			.insert(tables.plugin)
			.values({ scope: "system", slug: "provider", status: "disabled", id: "provider-plugin" });
		yield* db
			.insert(tables.sandboxProvider)
			.values({
				id: providerId,
				slug: "provider",
				name: "Provider",
				rootEntitySchemaSlug: slug,
				pluginId: "provider-plugin",
				information: { source: "fixture" },
			});
	});
	it.effect(
		"persists provider provenance and population-only updates; existing provider create is a noop",
		() =>
			withEntities(
				Effect.gen(function* () {
					yield* seedProvider;
					const service = yield* EntitiesService;
					const db = yield* Database;
					const input = {
						providerId,
						name: "Global",
						populatedAt: null,
						externalId: "external",
						entitySchemaSlug: slug,
						lifecycle: command("global"),
						properties: { title: "global" },
					};
					const created = yield* service.createGlobal(input);
					expect(created.entity).toMatchObject({
						providerId,
						populatedAt: null,
						externalId: "external",
					});
					expect(
						yield* service.createGlobal({
							...input,
							name: "Ignored",
							lifecycle: command("global-noop"),
						}),
					).toEqual({ warnings: [], entity: created.entity });
					const populatedAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-15T01:00:00.000Z"));
					const updated = yield* service.upsert({
						...input,
						populatedAt,
						scope: "global",
						updateExisting: false,
						lifecycle: command("population"),
					});
					expect(updated.outcome).toEqual({
						operation: "update",
						after: updated.entity,
						before: created.entity,
					});
					expect(updated.entity.populatedAt).toBe("2026-09-15T01:00:00.000Z");
					const noop = yield* service.upsert({
						...input,
						scope: "global",
						name: "Ignored",
						updateExisting: false,
						lifecycle: command("upsert-noop"),
					});
					expect(noop.outcome.operation).toBe("noop");
					expect(noop.entity).toEqual(updated.entity);
					expect(
						(yield* db.select().from(tables.automationTrigger)).filter(
							(row) => row.category === "change",
						).length,
					).toBe(2);
				}),
			),
	);
	it.effect("caps global bulk writes under lock and returns per-item warnings", () =>
		withEntities(
			Effect.gen(function* () {
				yield* seedProvider;
				const service = yield* EntitiesService;
				const db = yield* Database;
				const items = ["one", "two", "three"].map((externalId) => ({
					externalId,
					name: externalId,
					populatedAt: null,
					entitySchemaSlug: slug,
					properties: { title: externalId },
				}));
				const result = yield* service.upsertGlobalEntities(items, providerId, command("bulk"), {
					maximumTotal: 2,
				});
				expect(result.map((item) => item.status)).toEqual(["upserted", "upserted", "skipped"]);
				expect(result.map((item) => item.warnings)).toEqual([[warning], [warning], []]);
				const replay = yield* service.upsertGlobalEntities(items, providerId, command("bulk"), {
					maximumTotal: 2,
				});
				expect(replay).toMatchObject([
					{ wasInserted: false },
					{ wasInserted: false },
					{ status: "skipped" },
				]);
				expect((yield* db.select().from(tables.entity)).length).toBe(2);
				expect(
					(yield* db.select().from(tables.automationTrigger)).filter(
						(row) => row.category === "change",
					).length,
				).toBe(2);
			}),
			{ warnings: [warning] },
		),
	);
	it.effect(
		"atomically rolls source and change trigger back on planning failure, retaining request history",
		() =>
			withEntities(
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const db = yield* Database;
					expect(yield* service.create(createInput("rollback")).pipe(Effect.flip)).toMatchObject({
						_tag: "DbError",
						message: "Injected planning failure after insert",
					});
					expect(yield* db.select().from(tables.entity)).toEqual([]);
					const triggers = yield* db.select().from(tables.automationTrigger);
					expect(triggers.map((row) => row.category)).toEqual(["request"]);
				}),
				{ failChange: true },
			),
	);

	it.effect(
		"returns warnings after commit, replays create once and rejects conflicting command content",
		() =>
			withEntities(
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const db = yield* Database;
					const first = yield* service.create(createInput("replay"));
					expect(first.warnings).toEqual([warning]);
					expect(first.entity.name).toBe("Original");
					expect(yield* service.create(createInput("replay"))).toEqual(first);
					expect(
						yield* service
							.create({ ...createInput("replay"), properties: { title: "different" } })
							.pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					expect((yield* db.select().from(tables.entity)).length).toBe(1);
					const triggers = yield* db.select().from(tables.automationTrigger);
					expect(triggers.length).toBe(2);
					const change = triggers.find((row) => row.category === "change");
					const request = triggers.find((row) => row.category === "request");
					assert(change && request);
					expect(change.payload).toEqual({
						category: "change",
						resource: "entity",
						operation: "create",
						after: first.entity,
					});
					expect(change.parentTriggerId).toBe(request.id);
				}),
				{ warnings: [warning] },
			),
	);

	it.effect(
		"captures exact persisted update/delete snapshots and leaves noop timestamps untouched",
		() =>
			withEntities(
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const db = yield* Database;
					const created = yield* service.create(createInput("create"));
					const input = {
						userId: owner,
						name: "Updated",
						populatedAt: null,
						scope: "user" as const,
						entityId: created.entity.id,
						lifecycle: command("update"),
						properties: { title: "updated" },
					};
					const updated = yield* service.update(input);
					const noop = yield* service.update({ ...input, lifecycle: command("noop") });
					expect(noop.entity).toEqual(updated.entity);
					const deleted = yield* service.deleteByIds([created.entity.id], command("delete"));
					expect(deleted).toEqual({ warnings: [], deletedCount: 1 });
					expect(yield* service.deleteByIds([created.entity.id], command("delete"))).toEqual({
						warnings: [],
						deletedCount: 0,
					});
					const changes = (yield* db.select().from(tables.automationTrigger)).filter(
						(row) => row.category === "change",
					);
					expect(changes.length).toBe(3);
					expect(changes.find((row) => row.operation === "update")?.payload).toEqual({
						category: "change",
						resource: "entity",
						operation: "update",
						after: updated.entity,
						before: created.entity,
					});
					expect(changes.find((row) => row.operation === "delete")?.payload).toEqual({
						category: "change",
						resource: "entity",
						operation: "delete",
						before: updated.entity,
					});
					expect(yield* db.select().from(tables.entity)).toEqual([]);
				}),
			),
	);

	for (const [name, options, code] of [
		[
			"rejected",
			{
				policies: [
					{ action: "reject", reason: "Denied" },
					{ action: "reject", reason: "Should not execute" },
				],
			},
			"policy-rejected",
		],
		["blocked", { blocked: true }, "automation-limit"],
		[
			"failed",
			{ policies: ["fail", { action: "reject", reason: "Should not execute" }] },
			"policy-execution-failed",
		],
	] as const) {
		const policyCalls: string[] = [];
		const skippedPolicyTriggers: string[] = [];
		it.effect(`retains ${name} request without a source mutation`, () =>
			withEntities(
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const db = yield* Database;
					const error = yield* service.create(createInput(name)).pipe(Effect.flip);
					expect(error).toMatchObject({ reason: { code }, _tag: "EntityBadRequest" });
					if (name === "rejected") {
						expect(error).toMatchObject({ reason: { message: "Denied" } });
					}
					if (name === "failed") {
						expect(error).toMatchObject({ reason: { runId: "policy-0" } });
					}
					expect(yield* db.select().from(tables.entity)).toEqual([]);
					const [request] = yield* db
						.select()
						.from(tables.automationTrigger)
						.where(eq(tables.automationTrigger.category, "request"));
					assert(request);
					expect(policyCalls).toEqual(name === "blocked" ? [] : ["policy-0"]);
					expect(skippedPolicyTriggers).toEqual(name === "blocked" ? [] : [request.id]);
				}),
				{ ...options, policyCalls, skippedPolicyTriggers },
			),
		);
	}

	const proposal = (name: string, properties: { title: string }) => ({
		action: "transform" as const,
		payload: {
			resource: "entity" as const,
			category: "request" as const,
			operation: "create" as const,
			draft: {
				name,
				properties,
				externalId: null,
				providerId: null,
				populatedAt: null,
				entitySchemaSlug: slug,
			},
		},
	});

	it.effect("chains transforms in order then validates the final draft", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				expect((yield* service.create(createInput("transform"))).entity).toMatchObject({
					name: "Second",
					properties: { title: "second" },
				});
			}),
			{
				policies: [proposal("First", { title: "first" }), proposal("Second", { title: "second" })],
			},
		),
	);

	it.effect("rejects a transform that changes provider identity", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const db = yield* Database;
				expect(yield* service.create(createInput("identity")).pipe(Effect.flip)).toMatchObject({
					reason: { code: "invalid-policy-transform" },
				});
				expect(yield* db.select().from(tables.entity)).toEqual([]);
			}),
			{
				policies: [
					{
						action: "transform",
						payload: {
							...proposal("Wrong", { title: "wrong" }).payload,
							draft: {
								...proposal("Wrong", { title: "wrong" }).payload.draft,
								externalId: "changed",
							},
						},
					},
				],
			},
		),
	);

	it.effect("revalidates transformed properties against AppSchema", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const db = yield* Database;
				expect(yield* service.create(createInput("invalid")).pipe(Effect.flip)).toMatchObject({
					reason: { code: "invalid-properties" },
				});
				expect(yield* db.select().from(tables.entity)).toEqual([]);
			}),
			{
				policies: [
					{
						action: "transform",
						payload: {
							...proposal("Wrong", { title: "wrong" }).payload,
							draft: {
								...proposal("Wrong", { title: "wrong" }).payload.draft,
								properties: { title: 42 },
							},
						},
					},
				],
			},
		),
	);

	it.effect("rejects enclosing caller transactions before request planning", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const db = yield* Database;
				const error = yield* db
					.transaction((tx) =>
						service.create(createInput("nested")).pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.flip);
				expect(error).toMatchObject({ reason: { code: "enclosing-transaction" } });
				expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
			}),
		),
	);

	it.effect("requires an active transaction and defers after execution until commit", () =>
		withEntities(
			Effect.gen(function* () {
				yield* seedProvider;
				const service = yield* EntitiesService;
				const db = yield* Database;
				const input = {
					providerId,
					name: "Planned",
					populatedAt: null,
					updateExisting: true,
					externalId: "planned",
					entitySchemaSlug: slug,
					scope: "global" as const,
					lifecycle: command("planned"),
					properties: { title: "planned" },
				};
				expect(yield* service.persistPlannedProviderUpsert(input).pipe(Effect.flip)).toMatchObject({
					code: "active-transaction-required",
				});
				const work = yield* db.transaction((tx) =>
					service.persistPlannedProviderUpsert(input).pipe(Effect.provideService(Database, tx)),
				);
				expect(work.result).toMatchObject({ wasInserted: true, outcome: { operation: "create" } });
				expect(work.plans).toHaveLength(1);
				expect(
					yield* db
						.transaction((tx) =>
							service.executeCommittedPlans(work.plans).pipe(Effect.provideService(Database, tx)),
						)
						.pipe(Effect.flip),
				).toMatchObject({ code: "postcommit-requires-root" });
				expect(yield* service.executeCommittedPlans(work.plans)).toEqual([warning]);
			}),
			{ warnings: [warning] },
		),
	);

	it.effect("rolls back transaction-scoped provider persistence when a before policy matches", () =>
		withEntities(
			Effect.gen(function* () {
				yield* seedProvider;
				const service = yield* EntitiesService;
				const db = yield* Database;
				const error = yield* db
					.transaction((tx) =>
						service
							.persistPlannedProviderUpsert({
								providerId,
								name: "Policy",
								scope: "global",
								populatedAt: null,
								externalId: "policy",
								updateExisting: true,
								entitySchemaSlug: slug,
								properties: { title: "policy" },
								lifecycle: command("planned-policy"),
							})
							.pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.flip);
				expect(error).toMatchObject({ code: "before-policy-requires-owner" });
				expect(yield* db.select().from(tables.entity)).toEqual([]);
				expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
			}),
			{ policies: [{ action: "allow" }] },
		),
	);

	it.effect("ensures bootstrap entities with warnings and no duplicate changes", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const db = yield* Database;
				const items = [
					{ name: "Routine", entitySchemaSlug: slug, properties: { title: "routine" } },
				];
				const first = yield* service.ensureUserEntities(owner, items, command("ensure"));
				expect(first).toMatchObject([{ wasInserted: true, warnings: [warning] }]);
				expect(yield* service.ensureUserEntities(owner, items, command("ensure"))).toEqual([
					{ warnings: [], wasInserted: false, entityId: first[0]?.entityId },
				]);
				expect((yield* db.select().from(tables.entity)).length).toBe(1);
				expect(
					(yield* db.select().from(tables.automationTrigger)).filter(
						(row) => row.category === "change",
					).length,
				).toBe(1);
			}),
			{ warnings: [warning] },
		),
	);

	it.effect("rolls the entire ensure batch back when its change plan fails", () =>
		withEntities(
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const db = yield* Database;
				yield* service
					.ensureUserEntities(
						owner,
						[{ name: "Routine", entitySchemaSlug: slug, properties: { title: "routine" } }],
						command("ensure-rollback"),
					)
					.pipe(Effect.flip);
				expect(yield* db.select().from(tables.entity)).toEqual([]);
				expect(
					(yield* db.select().from(tables.automationTrigger)).map((row) => row.category),
				).toEqual(["request"]);
			}),
			{ failChange: true },
		),
	);
});
