import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import type { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { layer } from "@voila.dev/effect-bun-test";
import { Cause, Context, Effect, Fiber, Layer, Metric } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { EventsService } from "#modules/events/service";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { makeWorkflowActivityEngine } from "#testing/effect";

import {
	EntityImportError,
	EntityImportWorkflow,
	runEntityImportWorkflow,
} from "./entity-import-workflow";
import { EntityImportWorkflowOperations } from "./operations-workflow";

const importCommand = (executionId: string, userId: UserId) => ({
	...rootLifecycleCommand({
		source: "import",
		lane: "background",
		initiator: { id: userId, kind: "user" },
		itemIdentity: `provider-import:${executionId}`,
		executionId: AutomationExecutionId.make(executionId),
		occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
		accountGeneration: { userId, token: "test-account-generation" },
	}),
	writeContext: null,
});
const pluginId = PluginId.make("fixture-owner");

const provideEvents = (create?: EventsService["Service"]["create"]) =>
	Effect.provideServiceEffect(
		EventsService,
		Effect.map(
			Layer.build(Layer.mock(EventsService)(create ? { create } : {})),
			Context.get(EventsService),
		),
	);

const importWithoutMembership = (entitySchemaSlug: string) => {
	const executionId = `${entitySchemaSlug}-import`;
	const calls: Array<{ name: string; options: Record<string, unknown> }> = [];
	const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
	const entity = {
		properties: {},
		name: "Fixture",
		externalId: "external-1",
		id: EntityId.make("fixture-1"),
		entitySchemaPluginId: pluginId,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		populatedAt: "2026-01-01T00:00:00.000Z",
		providerId: SandboxProviderId.make("provider-1"),
		entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
	};

	return Effect.gen(function* () {
		const userId = UserId.make("user-1");
		const result = yield* runEntityImportWorkflow(
			{
				pluginId,
				executionId,
				externalId: "external-1",
				entityScope: { userId, type: "global" },
				command: importCommand(executionId, userId),
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
			},
			executionId,
		);

		expect(result).toEqual(entity);
		expect(calls).toEqual<unknown>([
			objectContaining({
				name: "ProviderEntityPopulationWorkflow",
				options: objectContaining({
					executionId: `${executionId}-provider-population`,
					payload: objectContaining({ level: "base", mode: "ensure" }),
				}),
			}),
			{ options: { executionId }, name: "provider-import-completion" },
		]);
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, {
				execute: (workflow, options) =>
					Effect.sync(() => {
						calls.push({ options, name: workflow._tag });
						return entity;
					}),
			}),
		),
		Effect.provideService(WorkflowInstance, instance),
		provideEvents(),
		Effect.provideService(EntityImportWorkflowOperations, {
			processSandbox: () => Effect.die("unused"),
			processRelatedPage: () => Effect.die("unused"),
			requireRelatedScript: () => Effect.die("unused"),
			processProviderResolve: () => Effect.die("unused"),
			preRegisterProviderImport: () => Effect.die("unused"),
			completeProviderEntityImport: (_payload, _entity, hookExecutionId) =>
				Effect.sync(() => {
					calls.push({
						name: "provider-import-completion",
						options: { executionId: hookExecutionId },
					});
				}),
		}),
	);
};

const importWithEntryEvent = (
	executionId: string,
	createEventsResult: Pick<CreateEventsResponse, "failure">,
) => {
	const calls: Array<{ name: string; options: Record<string, unknown> }> = [];
	const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
	const userId = UserId.make("user-1");
	const entity = {
		properties: {},
		name: "Fixture",
		externalId: "external-1",
		id: EntityId.make("fixture-1"),
		entitySchemaPluginId: pluginId,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		populatedAt: "2026-01-01T00:00:00.000Z",
		providerId: SandboxProviderId.make("provider-1"),
		entitySchemaSlug: EntitySchemaSlug.make("record"),
	};
	const run = runEntityImportWorkflow(
		{
			pluginId,
			executionId,
			externalId: "external-1",
			entityScope: { userId, type: "global" },
			command: importCommand(executionId, userId),
			providerId: SandboxProviderId.make("provider-1"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
			entryEventSchemaSlug: EventSchemaSlug.make("planned"),
		},
		executionId,
	).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, {
				execute: (workflow, options) =>
					Effect.sync(() => {
						calls.push({ options, name: workflow._tag });
						return entity;
					}),
			}),
		),
		Effect.provideService(WorkflowInstance, instance),
		provideEvents((input) =>
			Effect.sync(() => {
				calls.push({ name: "EventCreate", options: { payload: input } });
				return { count: 1, outcomes: [], warnings: [], ...createEventsResult };
			}),
		),
		Effect.provideService(EntityImportWorkflowOperations, {
			processSandbox: () => Effect.die("unused"),
			processRelatedPage: () => Effect.die("unused"),
			requireRelatedScript: () => Effect.die("unused"),
			processProviderResolve: () => Effect.die("unused"),
			preRegisterProviderImport: () => Effect.die("unused"),
			completeProviderEntityImport: () =>
				Effect.sync(() => {
					calls.push({ options: {}, name: "provider-import-completion" });
				}),
		}),
	);
	return { run, calls, entity, userId };
};

layer(mutationAdmissionTestLayer)((it) => {
	it.effect(
		"records the requested entry event once the import completes",
		() => {
			const executionId = "entry-event-import";
			const { run, calls, entity, userId } = importWithEntryEvent(executionId, { failure: null });
			return Effect.gen(function* () {
				expect(yield* run).toEqual(entity);
				expect(calls.map(({ name }) => name)).toEqual([
					"ProviderEntityPopulationWorkflow",
					"provider-import-completion",
					"EventCreate",
				]);
				expect(calls[2]?.options).toMatchObject({
					payload: {
						userId,
						payload: [{ properties: {}, entityId: entity.id, eventSchemaSlug: "planned" }],
						command: {
							writeContext: null,
							causation: { executionId },
							itemIdentity: stableStringify([`provider-import:${executionId}`, "entry-event"]),
						},
					},
				});
			});
		},
		testTimeout,
	);

	it.effect(
		"fails the import at the entry-event stage when the event is refused",
		() => {
			const { run } = importWithEntryEvent("refused-entry-event", {
				failure: { index: 0, reason: { code: "invalid-properties" } },
			});
			return Effect.gen(function* () {
				expect(yield* Effect.flip(run)).toMatchObject({
					stage: "entry-event",
					message: "invalid-properties",
				});
			});
		},
		testTimeout,
	);

	it.effect(
		"runs provider-import completion after provider population",
		() => importWithoutMembership("unrelated-fixture"),
		testTimeout,
	);

	it.effect(
		"imports a sample entity without example membership work",
		() => importWithoutMembership("routine"),
		testTimeout,
	);

	it.effect(
		"fails the import when provider-import completion fails",
		() => {
			const executionId = "failed-import";
			const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
			const entity = {
				properties: {},
				name: "Fixture",
				externalId: "external-1",
				id: EntityId.make("fixture-1"),
				entitySchemaPluginId: pluginId,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				populatedAt: "2026-01-01T00:00:00.000Z",
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			};

			return Effect.gen(function* () {
				const userId = UserId.make("user-1");
				const error = yield* Effect.flip(
					runEntityImportWorkflow(
						{
							pluginId,
							executionId,
							externalId: "external-1",
							entityScope: { userId, type: "global" },
							command: importCommand(executionId, userId),
							providerId: SandboxProviderId.make("provider-1"),
							entitySchemaSlug: EntitySchemaSlug.make("record"),
						},
						executionId,
					),
				);
				expect(error).toBeInstanceOf(EntityImportError);
				expect(error).toMatchObject({
					message: "membership hook failed",
					stage: "provider-import-automation",
				});
			}).pipe(
				Effect.provideService(
					WorkflowEngine,
					makeWorkflowActivityEngine(instance, { execute: () => Effect.succeed(entity) }),
				),
				Effect.provideService(WorkflowInstance, instance),
				provideEvents(),
				Effect.provideService(EntityImportWorkflowOperations, {
					processSandbox: () => Effect.die("unused"),
					processRelatedPage: () => Effect.die("unused"),
					requireRelatedScript: () => Effect.die("unused"),
					processProviderResolve: () => Effect.die("unused"),
					preRegisterProviderImport: () => Effect.die("unused"),
					completeProviderEntityImport: () =>
						Effect.fail(
							new SandboxRunError({ kind: "script-failure", message: "membership hook failed" }),
						),
				}),
			);
		},
		testTimeout,
	);

	it.effect(
		"records a suspended body and its replay as separate attempts without growing the gauge",
		() => {
			const executionId = "replayed-import";
			const userId = UserId.make("user-1");
			const entity = {
				properties: {},
				name: "Fixture",
				externalId: "external-1",
				id: EntityId.make("fixture-1"),
				entitySchemaPluginId: pluginId,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				populatedAt: "2026-01-01T00:00:00.000Z",
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			};
			const payload = {
				pluginId,
				executionId,
				externalId: "external-1",
				command: importCommand(executionId, userId),
				entityScope: { userId, type: "global" as const },
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			};
			let populationReady = false;
			const runBody = () => {
				const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
				return runEntityImportWorkflow(payload, executionId).pipe(
					Effect.provideService(
						WorkflowEngine,
						makeWorkflowActivityEngine(instance, {
							execute: () =>
								populationReady ? Effect.succeed(entity) : Workflow.suspend(instance),
						}),
					),
					Effect.provideService(WorkflowInstance, instance),
					provideEvents(),
					Effect.provideService(EntityImportWorkflowOperations, {
						processSandbox: () => Effect.die("unused"),
						processRelatedPage: () => Effect.die("unused"),
						completeProviderEntityImport: () => Effect.void,
						requireRelatedScript: () => Effect.die("unused"),
						processProviderResolve: () => Effect.die("unused"),
						preRegisterProviderImport: () => Effect.die("unused"),
					}),
				);
			};

			return Effect.gen(function* () {
				const activeBodies = Effect.map(
					Metric.snapshot,
					(snapshots) =>
						snapshots.find(({ id }) => id === "ryot.provider_import.executing_bodies")?.state,
				);

				// The suspension interrupts the body's own fiber, so the attempt runs in a child fiber.
				const suspended = yield* Fiber.await(yield* Effect.forkChild(runBody()));
				expect(suspended._tag === "Failure" && Cause.hasInterruptsOnly(suspended.cause)).toBe(true);
				expect(yield* activeBodies).toMatchObject({ value: 0 });

				populationReady = true;
				expect(yield* runBody()).toEqual(entity);
				expect(yield* activeBodies).toMatchObject({ value: 0 });

				const phases = (yield* Metric.snapshot).filter(
					({ id }) => id === "ryot.provider_import.phase_attempt_duration",
				);
				expect(phases).toHaveLength(3);
				expect(phases).toEqual<unknown>(
					arrayContaining([
						objectContaining({
							state: objectContaining({ count: 1 }),
							attributes: objectContaining({ phase: "population", outcome: "interrupted" }),
						}),
						objectContaining({
							state: objectContaining({ count: 1 }),
							attributes: objectContaining({ outcome: "success", phase: "population" }),
						}),
						objectContaining({
							state: objectContaining({ count: 1 }),
							attributes: objectContaining({
								outcome: "success",
								phase: "provider-import-automation",
							}),
						}),
					]),
				);
			}).pipe(Effect.provideService(Metric.MetricRegistry, new Map()));
		},
		testTimeout,
	);
});
