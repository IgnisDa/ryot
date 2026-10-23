import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { SandboxExecutionError } from "@ryot-app/contract/modules/scripts/schemas";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { and, eq, isNull } from "drizzle-orm";
import { Cause, Context, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { getCatalogTable, resolveCatalogField } from "#modules/ryotql/catalog";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import type { SandboxExecutionResult } from "#modules/scripts/executions/result";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeRedisService, makeWorkflowActivityEngine } from "#testing/effect";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	type ProviderEntityPopulationPayload,
	ProviderEntityPopulationWorkflow,
	runProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";

const userId = UserId.make("owner");
const rootSchemaSlug = EntitySchemaSlug.make("record");
const occurredAt = IsoUtcString.make("2026-10-23T00:00:00.000Z");
const occurredAtDate = new Date(occurredAt);

type Sandbox = Effect.Effect<SandboxExecutionResult>;

class FailureFixture extends Context.Service<
	FailureFixture,
	{
		readonly published: Effect.Effect<ReadonlyArray<string>>;
		readonly seed: (input: {
			readonly externalId: string;
			readonly populatedAt?: Date;
		}) => Effect.Effect<EntityId>;
		readonly read: (
			entityId: EntityId,
		) => Effect.Effect<{
			readonly populatedAt: Date | null;
			readonly populationFailure: string | null;
			readonly populationFailedAt: Date | null;
			readonly populationStatus: string;
		}>;
		readonly setSandbox: (sandbox: Sandbox) => Effect.Effect<void>;
		readonly payload: (
			externalId: string,
			mode: "ensure" | "refresh",
		) => ProviderEntityPopulationPayload;
		readonly markPopulated: (entityId: EntityId) => Effect.Effect<void>;
		readonly stamp: (entityId: EntityId) => Effect.Effect<void>;
		readonly uninstall: Effect.Effect<void>;
		readonly rotateAccount: Effect.Effect<void>;
	}
>()("test/PopulationFailureFixture") {}

const failed = (error: Omit<SandboxExecutionError, "phase">): SandboxExecutionResult => ({
	logs: [],
	value: null,
	status: "completed",
	error: { ...error, phase: "execute" },
});

const completed = (value: unknown): SandboxExecutionResult => ({
	value,
	logs: [],
	error: null,
	status: "completed",
});

const assertPopulationFails = (
	exit: Exit.Exit<unknown, SandboxRunError>,
	result: SandboxExecutionResult,
) => {
	if (result.error === null) {
		assert(Exit.isFailure(exit));
		const failure = Cause.findErrorOption(exit.cause);
		assert(Option.isSome(failure));
		expect(failure.value.kind).toBe("invalid-output");
		return;
	}
	const { kind, data, message } = result.error;
	assertExitFails(
		exit,
		new SandboxRunError({ kind, message, ...(data === undefined ? {} : { data }) }),
	);
};

const populationStatusSql = () => {
	const table = getCatalogTable("entity");
	assert(table);
	const field = resolveCatalogField(table, "populationStatus", {
		type: "user",
		audience: "kernel",
		accessClass: "standard",
	});
	assert(field);
	return field.resolve({ language: null, sqlAlias: "entity" });
};

const failureLayer = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const installed = yield* installRevisionPackage(
			revisionPackage("population", "v1", rootSchemaSlug),
		);
		const runtime = yield* PluginRuntimeResolver;
		const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
			slug: "population-provider",
			owner: definitionOwner(installed.pluginId),
		});
		assert(provider);
		const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
		const subject = {
			userId,
			type: "user" as const,
			accountGeneration: { userId, token: "test-account-generation" },
		};
		const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
		assert(pin?.pluginRevision);
		const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
		const published = yield* Ref.make<ReadonlyArray<string>>([]);
		const sandbox = yield* Ref.make<Sandbox>(Effect.die("no sandbox result"));
		const statusSql = populationStatusSql();
		const repository = yield* EntitiesRepository;
		const fixture = FailureFixture.of({
			published: Ref.get(published),
			setSandbox: (result) => Ref.set(sandbox, result),
			rotateAccount: session
				.run((db) =>
					db
						.update(tables.user)
						.set({ accountGeneration: "rotated-account-generation" })
						.where(eq(tables.user.id, userId)),
				)
				.pipe(Effect.asVoid, Effect.orDie),
			markPopulated: (entityId) =>
				session
					.run((db) =>
						db
							.update(tables.entity)
							.set({ populatedAt: occurredAtDate })
							.where(eq(tables.entity.id, entityId)),
					)
					.pipe(Effect.asVoid, Effect.orDie),
			stamp: (entityId) =>
				session
					.transaction(
						repository.updateEntity({
							entityId,
							properties: {},
							name: "Populated",
							populatedAt: occurredAtDate,
						}),
					)
					.pipe(Effect.asVoid, Effect.orDie),
			uninstall: session
				.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ uninstalledAt: occurredAtDate })
						.where(
							and(
								eq(tables.pluginInstallation.userId, userId),
								eq(tables.pluginInstallation.pluginId, installed.pluginId),
								isNull(tables.pluginInstallation.uninstalledAt),
							),
						),
				)
				.pipe(Effect.asVoid, Effect.orDie),
			seed: ({ externalId, populatedAt }) =>
				session
					.run((db) =>
						db
							.insert(tables.entity)
							.values({
								externalId,
								name: externalId,
								providerId: provider.id,
								populatedAt: populatedAt ?? null,
								entitySchemaSlug: rootSchemaSlug,
								entitySchemaPluginId: installed.pluginId,
							})
							.returning({ id: tables.entity.id }),
					)
					.pipe(
						Effect.map(([row]) => EntityId.make(row?.id ?? "")),
						Effect.orDie,
					),
			read: (entityId) =>
				session
					.run((db) =>
						db
							.select({
								populatedAt: tables.entity.populatedAt,
								populationStatus: statusSql.mapWith(String),
								populationFailure: tables.entity.populationFailure,
								populationFailedAt: tables.entity.populationFailedAt,
							})
							.from(tables.entity)
							.where(eq(tables.entity.id, entityId)),
					)
					.pipe(
						Effect.flatMap(([row]) => (row ? Effect.succeed(row) : Effect.die("missing row"))),
						Effect.orDie,
					),
			payload: (externalId, mode) => {
				const executionId = `population-${externalId}`;
				return {
					mode,
					externalId,
					executionId,
					level: "full" as const,
					providerId: provider.id,
					entitySchemaSlug: rootSchemaSlug,
					entityScope: { userId, type: "global" },
					pluginId: PluginId.make(installed.pluginId),
					command: {
						...rootLifecycleCommand({
							occurredAt,
							source: "api",
							lane: "interactive",
							itemIdentity: executionId,
							initiator: { id: userId, kind: "user" },
							executionId: AutomationExecutionId.make(executionId),
							accountGeneration: { userId, token: "test-account-generation" },
						}),
						writeContext: principal,
					},
				};
			},
		});
		return Layer.mergeAll(
			DomainWriteChecksLive,
			Layer.succeed(EntitiesRepository, repository),
			Layer.succeed(FailureFixture, fixture),
			Layer.succeed(
				RedisService,
				makeRedisService({
					publish: (_channel, message) =>
						Ref.update(published, (all) => [...all, message]).pipe(Effect.as(1)),
				}),
			),
			Layer.mock(EntitiesService)({}),
			Layer.mock(LifecycleExecution)({}),
			Layer.mock(RelationshipsService)({}),
			Layer.mock(RelationshipsRepository)({}),
			Layer.mock(EntityImportWorkflowOperations)({
				processSandbox: () => Effect.flatten(Ref.get(sandbox)),
			}),
		);
	}),
).pipe(Layer.provideMerge(EntitiesRepository.layer), Layer.provideMerge(revisionDatabaseLayer));

const populate = (input: {
	readonly sandbox: Sandbox;
	readonly externalId: string;
	readonly mode?: "ensure" | "refresh";
}) =>
	Effect.gen(function* () {
		const fixture = yield* FailureFixture;
		const payload = fixture.payload(input.externalId, input.mode ?? "ensure");
		const instance = WorkflowInstance.initial(
			ProviderEntityPopulationWorkflow,
			payload.executionId,
		);
		yield* fixture.setSandbox(input.sandbox);
		return yield* Effect.exit(
			runProviderEntityPopulationWorkflow(payload, payload.executionId).pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			),
		);
	});

const publication = (entityId: EntityId) =>
	encodeEntityUpdatedMessage(entityId, "population-failed");

const scriptFailure = failed({ kind: "script-failure", message: "Provider exploded" });

layer(failureLayer)((test) => {
	test.effect("marks each deterministic provider failure and publishes population-failed", () =>
		Effect.gen(function* () {
			const fixture = yield* FailureFixture;
			const cases = [
				{ result: scriptFailure, failure: "script-failure" },
				{
					failure: "invalid-output",
					result: failed({ kind: "invalid-output", message: "Malformed output" }),
				},
				{
					failure: "execution-limit",
					result: failed({
						kind: "resource-unavailable",
						message: "httpCall limit reached",
						data: { operation: "httpCall", code: "execution-limit" },
					}),
				},
				{
					failure: "execution-limit",
					result: failed({
						kind: "script-failure",
						message: "Sandbox execution exceeds 50 httpCall calls",
						data: { operation: "httpCall", code: "execution-limit" },
					}),
				},
				{ failure: "invalid-output", result: completed({ properties: {} }) },
			] as const;
			for (const [index, { result, failure }] of cases.entries()) {
				const externalId = `deterministic-${index}`;
				const entityId = yield* fixture.seed({ externalId });
				const exit = yield* populate({ externalId, sandbox: Effect.succeed(result) });

				assertPopulationFails(exit, result);
				const row = yield* fixture.read(entityId);
				expect(row.populationFailure).toBe(failure);
				expect(row.populationFailedAt).toBeInstanceOf(Date);
				expect(row.populationStatus).toBe("failed");
				expect(yield* fixture.published).toContain(publication(entityId));
			}
		}),
	);

	test.effect("leaves other failures pending exactly as before", () =>
		Effect.gen(function* () {
			const fixture = yield* FailureFixture;
			const results = [
				failed({ kind: "timeout", message: "Timed out" }),
				failed({ kind: "infrastructure", message: "Daemon unavailable" }),
				failed({ kind: "external-uncertain", message: "Unknown outcome" }),
				failed({
					kind: "resource-unavailable",
					message: "Operation unavailable",
					data: { operation: "httpCall", code: "unavailable-operation" },
				}),
				failed({
					kind: "script-failure",
					message: "Grant missing",
					data: { operation: "httpCall", code: "missing-artifact-grant" },
				}),
				failed({
					kind: "script-failure",
					message: "Operation unavailable",
					data: { operation: "httpCall", code: "unavailable-operation" },
				}),
			];
			for (const [index, result] of results.entries()) {
				const externalId = `pending-${index}`;
				const entityId = yield* fixture.seed({ externalId });
				const exit = yield* populate({ externalId, sandbox: Effect.succeed(result) });

				assertPopulationFails(exit, result);
				expect(yield* fixture.read(entityId)).toMatchObject({
					populatedAt: null,
					populationFailure: null,
					populationFailedAt: null,
					populationStatus: "pending",
				});
				expect(yield* fixture.published).not.toContain(publication(entityId));
			}
		}),
	);

	test.effect("clears the marker when a later population stamps the root", () =>
		Effect.gen(function* () {
			const fixture = yield* FailureFixture;
			const entityId = yield* fixture.seed({ externalId: "later-success" });
			yield* populate({ externalId: "later-success", sandbox: Effect.succeed(scriptFailure) });
			expect((yield* fixture.read(entityId)).populationStatus).toBe("failed");

			yield* fixture.stamp(entityId);

			expect(yield* fixture.read(entityId)).toMatchObject({
				populationFailure: null,
				populationFailedAt: null,
				populationStatus: "ready",
			});
		}),
	);

	test.effect("writes nothing when a refresh of a populated entity fails", () =>
		Effect.gen(function* () {
			const fixture = yield* FailureFixture;
			const entityId = yield* fixture.seed({
				populatedAt: occurredAtDate,
				externalId: "populated-refresh",
			});
			const exit = yield* populate({
				mode: "refresh",
				externalId: "populated-refresh",
				sandbox: Effect.succeed(scriptFailure),
			});

			assertPopulationFails(exit, scriptFailure);
			expect(yield* fixture.read(entityId)).toMatchObject({
				populationFailure: null,
				populationFailedAt: null,
				populationStatus: "ready",
			});
			expect(yield* fixture.published).not.toContain(publication(entityId));
		}),
	);

	test.effect("writes nothing when a newer population succeeded while the script ran", () =>
		Effect.gen(function* () {
			const fixture = yield* FailureFixture;
			const entityId = yield* fixture.seed({ externalId: "stale-failure" });
			const exit = yield* populate({
				externalId: "stale-failure",
				sandbox: fixture.markPopulated(entityId).pipe(Effect.as(scriptFailure)),
			});

			assertPopulationFails(exit, scriptFailure);
			expect(yield* fixture.read(entityId)).toMatchObject({
				populationFailure: null,
				populationFailedAt: null,
				populationStatus: "ready",
			});
			expect(yield* fixture.published).not.toContain(publication(entityId));
		}),
	);

	test.effect("does not expose the stored failure through the catalog", () =>
		Effect.sync(() => {
			const table = getCatalogTable("entity");
			assert(table);
			for (const access of [
				{ type: "user", audience: "kernel", accessClass: "standard" },
				{ type: "user", audience: "plugin", accessClass: "standard" },
				{ type: "plugin" },
			] as const) {
				expect(resolveCatalogField(table, "populationFailure", access)).toBeUndefined();
				expect(resolveCatalogField(table, "populationFailedAt", access)).toBeUndefined();
			}
		}),
	);
});

layer(failureLayer)((test) => {
	test.effect("does not mark a shared row when the caller's account rotated during the run", () =>
		Effect.gen(function* () {
			const fixture = yield* FailureFixture;
			const entityId = yield* fixture.seed({ externalId: "rotated-account" });
			const exit = yield* populate({
				externalId: "rotated-account",
				sandbox: fixture.rotateAccount.pipe(Effect.as(scriptFailure)),
			});

			assertPopulationFails(exit, scriptFailure);
			expect(yield* fixture.read(entityId)).toMatchObject({
				populationFailure: null,
				populationStatus: "pending",
			});
			expect(yield* fixture.published).toEqual([]);
		}),
	);
});

layer(failureLayer)((test) => {
	test.effect(
		"does not mark a shared row when the caller uninstalled the plugin during the run",
		() =>
			Effect.gen(function* () {
				const fixture = yield* FailureFixture;
				const entityId = yield* fixture.seed({ externalId: "uninstalled" });
				const exit = yield* populate({
					externalId: "uninstalled",
					sandbox: fixture.uninstall.pipe(Effect.as(scriptFailure)),
				});

				assertPopulationFails(exit, scriptFailure);
				expect(yield* fixture.read(entityId)).toMatchObject({
					populationFailure: null,
					populationStatus: "pending",
				});
				expect(yield* fixture.published).toEqual([]);
			}),
	);
});
