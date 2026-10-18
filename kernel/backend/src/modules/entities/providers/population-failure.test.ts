import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Context, DateTime, Duration, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { TranslationsService } from "#modules/entities/localization/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventStreamRepository } from "#modules/events/stream-repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeRedisService, makeWorkflowActivityEngine } from "#testing/effect";

import type { ProviderEntityPopulationPayload } from "./provider-entity-population-workflow";
import {
	ProviderEntityPopulationAttemptWorkflow,
	ProviderEntityPopulationWorkflow,
	runProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";

const now = IsoUtcString.make("2026-10-26T00:00:00.000Z");
const entity: ListedEntity = {
	name: "Record",
	properties: {},
	createdAt: now,
	updatedAt: now,
	populatedAt: now,
	externalId: "record",
	id: EntityId.make("populated-record"),
	entitySchemaPluginId: PluginId.make("plugin"),
	providerId: SandboxProviderId.make("provider"),
	entitySchemaSlug: EntitySchemaSlug.make("record"),
};

const payloadFor = (executionId: string): ProviderEntityPopulationPayload => ({
	executionId,
	level: "full",
	mode: "refresh",
	externalId: "record",
	pluginId: PluginId.make("plugin"),
	entityScope: { userId: null, type: "global" },
	providerId: SandboxProviderId.make("provider"),
	entitySchemaSlug: EntitySchemaSlug.make("record"),
	command: {
		...rootLifecycleCommand({
			occurredAt: now,
			lane: "background",
			accountGeneration: null,
			itemIdentity: executionId,
			source: "provider-refresh",
			initiator: { kind: "system", id: "population" },
			executionId: AutomationExecutionId.make(executionId),
		}),
		writeContext: null,
	},
});

class PopulationTarget extends Context.Service<
	PopulationTarget,
	{
		readonly entity: ListedEntity;
		readonly payload: (executionId: string) => ProviderEntityPopulationPayload;
	}
>()("test/PopulationTarget") {}

const requestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const installed = yield* installRevisionPackage(
			revisionPackage("population-parent", "one", entity.entitySchemaSlug),
		);
		const runtime = yield* PluginRuntimeResolver;
		const provider = yield* runtime.findProviderAvailableToUserByReference(UserId.make("owner"), {
			slug: "population-parent-provider",
			owner: definitionOwner(installed.pluginId),
		});
		assert(provider);
		const populated: ListedEntity = {
			...entity,
			providerId: provider.id,
			entitySchemaPluginId: PluginId.make(installed.pluginId),
		};
		const session = yield* DatabaseSession;
		const sessionLayer = Layer.succeed(DatabaseSession, session);
		const entitiesRepositoryLayer = EntitiesRepository.layer.pipe(
			Layer.provide(
				Layer.merge(sessionLayer, EventStreamRepository.layer.pipe(Layer.provide(sessionLayer))),
			),
		);
		yield* session.run((db) =>
			db
				.insert(tables.entity)
				.values({
					id: populated.id,
					name: populated.name,
					providerId: provider.id,
					externalId: populated.externalId,
					entitySchemaSlug: populated.entitySchemaSlug,
					entitySchemaPluginId: populated.entitySchemaPluginId,
					populatedAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
				}),
		);
		return Layer.mergeAll(
			Layer.succeed(PopulationTarget, {
				entity: populated,
				payload: (executionId) => ({
					...payloadFor(executionId),
					providerId: provider.id,
					pluginId: PluginId.make(installed.pluginId),
				}),
			}),
			EnrichmentRequests.layer.pipe(
				Layer.provide(
					Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
				),
			),
			Layer.mock(TranslationsService)({ requestFill: () => Effect.succeed(false) }),
			entitiesRepositoryLayer,
		);
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

const harness = Effect.fnUntraced(function* (
	executionId: string,
	outcomes: ReadonlyArray<ListedEntity | SandboxRunError | "suspend">,
) {
	const requests = yield* EnrichmentRequests;
	const target = yield* PopulationTarget;
	const attempts: Array<{
		id: string;
		payload: ProviderEntityPopulationPayload;
		requestId: string;
	}> = [];
	const clocks: Array<{ name: string; duration: number }> = [];
	const states: Array<{ state: string; attempt: number; nextAttemptAt: Date | null }> = [];
	const instance = WorkflowInstance.initial(ProviderEntityPopulationWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		deferredResult: () => Effect.succeedSome(Exit.void),
		scheduleClock: (_workflow, options) =>
			Effect.gen(function* () {
				clocks.push({
					name: options.clock.name,
					duration: Duration.toMillis(options.clock.duration),
				});
				const row = yield* requests.get(executionId).pipe(Effect.orDie);
				assert(row);
				states.push({ state: row.state, attempt: row.attempt, nextAttemptAt: row.nextAttemptAt });
			}),
		execute: (workflow, options) =>
			Effect.gen(function* () {
				expect(workflow._tag).toBe(ProviderEntityPopulationAttemptWorkflow._tag);
				expect(options.discard).not.toBe(true);
				const payload = yield* Schema.decodeUnknownEffect(
					ProviderEntityPopulationAttemptWorkflow.payloadSchema,
				)(options.payload).pipe(Effect.orDie);
				attempts.push({ payload, id: options.executionId, requestId: payload.requestId });
				const row = yield* requests.get(executionId).pipe(Effect.orDie);
				assert(row);
				states.push({ state: row.state, attempt: row.attempt, nextAttemptAt: row.nextAttemptAt });
				const outcome = outcomes[attempts.length - 1];
				assert(outcome);
				if (outcome === "suspend") {
					return yield* Workflow.suspend(instance);
				}
				return outcome instanceof SandboxRunError ? yield* outcome : target.entity;
			}),
	});
	return {
		clocks,
		states,
		attempts,
		entity: target.entity,
		read: requests.get(executionId),
		payload: target.payload(executionId),
		run: (payload = target.payload(executionId)) =>
			runProviderEntityPopulationWorkflow(payload, executionId).pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, engine),
			),
	};
});

layer(requestLayer)((test) => {
	test.effect("does not infer cancellation when an awaited child suspends the workflow", () =>
		Effect.gen(function* () {
			const h = yield* harness("suspended-child", ["suspend"]);
			const running = yield* Effect.forkChild(h.run());
			const exit = yield* Fiber.await(running);
			expect(Exit.isFailure(exit)).toBe(true);
			expect(yield* h.read).toMatchObject({ attempt: 1, state: "running" });
			expect(h.clocks).toEqual([]);
			yield* (yield* EnrichmentRequests).update("suspended-child", { state: "cancelled" });
		}),
	);
	test.effect(
		"retries infrastructure and timeout failures in new admitted attempts with durable delays",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("retry-success", [
					new SandboxRunError({ kind: "infrastructure", message: "Daemon unavailable" }),
					new SandboxRunError({ kind: "timeout", message: "Timed out" }),
					entity,
				]);
				expect(yield* h.run()).toEqual(h.entity);
				expect(h.attempts.map(({ id }) => id)).toEqual(
					[1, 2, 3].map((attempt) => `retry-success-attempt-${attempt}`),
				);
				expect(h.attempts.map(({ payload }) => payload.command.causation.executionId)).toEqual(
					h.attempts.map(({ id }) => id),
				);
				expect(h.attempts.every(({ requestId }) => requestId === "retry-success")).toBe(true);
				expect(h.clocks).toEqual([
					{ duration: 5_000, name: "population-retry:1" },
					{ duration: 30_000, name: "population-retry:2" },
				]);
				expect(h.states.map(({ state, attempt }) => ({ state, attempt }))).toEqual([
					{ attempt: 1, state: "running" },
					{ attempt: 1, state: "retrying" },
					{ attempt: 2, state: "running" },
					{ attempt: 2, state: "retrying" },
					{ attempt: 3, state: "running" },
				]);
				const clock = yield* DateTime.now;
				expect(h.states[1]?.nextAttemptAt).toEqual(
					DateTime.toDateUtc(DateTime.add(clock, { seconds: 5 })),
				);
				expect(h.states[3]?.nextAttemptAt).toEqual(
					DateTime.toDateUtc(DateTime.add(clock, { seconds: 30 })),
				);
				expect(yield* h.read).toMatchObject({
					attempt: 3,
					failureKind: null,
					state: "succeeded",
					nextAttemptAt: null,
					entityId: h.entity.id,
				});
			}),
	);

	test.effect("fails after three attempts without reporting success", () =>
		Effect.gen(function* () {
			const failure = new SandboxRunError({ kind: "infrastructure", message: "Still unavailable" });
			const h = yield* harness("retry-exhausted", [failure, failure, failure]);
			assertExitFails(yield* Effect.exit(h.run()), failure);
			expect(h.attempts).toHaveLength(3);
			expect(h.clocks).toHaveLength(2);
			expect(yield* h.read).toMatchObject({
				attempt: 3,
				state: "failed",
				nextAttemptAt: null,
				failureKind: "infrastructure",
			});
		}),
	);

	test.effect(
		"never retries boundary failures, external uncertainty, or unknown script errors",
		() =>
			Effect.gen(function* () {
				const failures = [
					new SandboxRunError({ kind: "script-failure", message: "Unknown provider error" }),
					new SandboxRunError({ kind: "invalid-output", message: "Invalid provider response" }),
					new SandboxRunError({ kind: "external-uncertain", message: "Unknown external outcome" }),
					new SandboxRunError({
						message: "Budget exceeded",
						kind: "resource-unavailable",
						data: { operation: "httpCall", code: "execution-limit" },
					}),
					new SandboxRunError({
						kind: "infrastructure",
						message: "Unavailable boundary",
						data: { operation: "httpCall", code: "unavailable-operation" },
					}),
					new SandboxRunError({
						kind: "timeout",
						message: "Boundary timeout",
						data: { code: "operation-rejected" },
					}),
				];
				for (const [index, failure] of failures.entries()) {
					const h = yield* harness(`nonretryable-${index}`, [failure]);
					assertExitFails(yield* Effect.exit(h.run()), failure);
					expect(h.attempts).toHaveLength(1);
					expect(h.clocks).toEqual([]);
					expect(yield* h.read).toMatchObject({
						attempt: 1,
						state: "failed",
						failureKind: failure.kind,
					});
				}
			}),
	);

	test.effect("uses the persisted request payload rather than a changed replay input", () =>
		Effect.gen(function* () {
			const requests = yield* EnrichmentRequests;
			const h = yield* harness("persisted-request", [entity]);
			const original = h.payload;
			yield* requests.ensure({
				level: "full",
				entityId: null,
				language: null,
				requester: null,
				payload: original,
				scopeUserId: null,
				operation: "population",
				id: original.executionId,
				pluginId: original.pluginId,
				providerId: original.providerId,
				externalId: original.externalId,
				entitySchemaSlug: original.entitySchemaSlug,
				workflowName: ProviderEntityPopulationWorkflow._tag,
			});
			yield* h.run({ ...original, mode: "ensure" });
			expect(h.attempts[0]?.payload.mode).toBe("refresh");
		}),
	);
});
