import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
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
import { partialFake } from "@ryot-app/testing/fakes";
import { objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsService } from "#modules/events/service";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { JobQueue } from "#platform/jobs/queue";
import { TransientValues } from "#platform/transient-values";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { fakeDatabaseSession } from "#testing/effect";

import { runEntityImportJob } from "./entity-import-job";
import { EntityImportWorkflowOperations } from "./operations-workflow";

const pluginId = PluginId.make("fixture-owner");
const userId = UserId.make("user-1");

const entity: ListedEntity = {
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

const importPayload = (executionId: string, entryEvent: boolean) => ({
	pluginId,
	executionId,
	externalId: "external-1",
	providerId: SandboxProviderId.make("provider-1"),
	entityScope: { userId, type: "global" as const },
	entitySchemaSlug: EntitySchemaSlug.make("record"),
	...(entryEvent ? { entryEventSchemaSlug: EventSchemaSlug.make("planned") } : {}),
	command: {
		...rootLifecycleCommand({
			source: "import",
			lane: "background",
			accountUserId: userId,
			initiator: { id: userId, kind: "user" },
			itemIdentity: `provider-import:${executionId}`,
			executionId: AutomationExecutionId.make(executionId),
			occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
		}),
		writeContext: null,
	},
});

type Harness = {
	readonly ready?: () => boolean;
	readonly eventResult?: Pick<CreateEventsResponse, "failure">;
	readonly completion?: () => Effect.Effect<void, SandboxRunError>;
};

const makeHarness = (options: Harness = {}) => {
	const calls: Array<{ name: string; options?: unknown }> = [];
	const stored = new Map<string, string>();
	const released: Array<string> = [];
	const services = Layer.mergeAll(
		fakeDatabaseSession({}),
		WorkflowExecutionNotifications.layer,
		Layer.mock(JobQueue)({ enqueue: () => Effect.succeed(true) }),
		Layer.mock(EntitiesRepository)({
			getById: () => Effect.succeed({ ...entity, properties: {} }),
		}),
		Layer.mock(ScriptExecutionService)({
			releaseWorkflowRegistration: (id) =>
				Effect.sync(() => {
					released.push(id);
				}),
		}),
		Layer.mock(TransientValues)({
			get: (key) => Effect.sync(() => stored.get(key) ?? null),
			set: (key, value) =>
				Effect.sync(() => {
					stored.set(key, value);
				}),
			setIfAbsent: (key, value) =>
				Effect.sync(() => {
					const absent = !stored.has(key);
					if (absent) {
						stored.set(key, value);
					}
					return absent;
				}),
		}),
		Layer.mock(EventsService)({
			create: (input) =>
				Effect.sync(() => {
					calls.push({ options: input, name: "entry-event" });
					return {
						count: 1,
						outcomes: [],
						warnings: [],
						...(options.eventResult ?? { failure: null }),
					};
				}),
		}),
		Layer.mock(EnrichmentRequests)({
			get: () =>
				Effect.sync(() =>
					partialFake<
						NonNullable<Effect.Success<ReturnType<EnrichmentRequests["Service"]["get"]>>>
					>({
						joinedTo: null,
						entityId: entity.id,
						state: (options.ready ?? (() => true))() ? "succeeded" : "running",
					}),
				),
			ensure: (input) =>
				Effect.sync(() => {
					calls.push({
						name: "population",
						options: { executionId: input.id, payload: input.payload },
					});
					return partialFake<Effect.Success<ReturnType<EnrichmentRequests["Service"]["ensure"]>>>({
						id: input.id,
						joinedTo: null,
						state: "queued",
					});
				}),
		}),
		Layer.succeed(EntityImportWorkflowOperations, {
			processSandbox: () => Effect.die("unused"),
			processRelatedPage: () => Effect.die("unused"),
			resolveRelatedInputs: () => Effect.die("unused"),
			processProviderResolve: () => Effect.die("unused"),
			preRegisterProviderImport: () => Effect.die("unused"),
			completeProviderEntityImport: () =>
				Effect.suspend(() => {
					calls.push({ name: "completion" });
					return options.completion?.() ?? Effect.void;
				}),
		}),
	);
	return {
		calls,
		stored,
		released,
		run: (executionId: string, attempt = 1, entryEvent = false) =>
			Effect.flatMap(Layer.build(services), (context) =>
				runEntityImportJob(importPayload(executionId, entryEvent), {
					attempt,
					id: executionId,
				}).pipe(Effect.provideContext(context)),
			).pipe(Effect.scoped),
	};
};

const outcomeOf = (stored: ReadonlyMap<string, string>, executionId: string) =>
	Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
		stored.get(`entity-import-outcome/${executionId}`) ?? "null",
	);

layer(mutationAdmissionTestLayer)((it) => {
	it.effect(
		"populates, runs completion hooks, stores the entity and releases its pin",
		() =>
			Effect.gen(function* () {
				const harness = makeHarness();
				yield* harness.run("plain-import");

				expect(harness.calls).toEqual<unknown>([
					{
						name: "population",
						options: objectContaining({
							executionId: "plain-import-provider-population",
							payload: objectContaining({ level: "base", mode: "ensure" }),
						}),
					},
					{ name: "completion" },
				]);
				expect(yield* outcomeOf(harness.stored, "plain-import")).toMatchObject({
					_tag: "completed",
					entity: { id: entity.id },
				});
				expect(harness.released).toEqual(["plain-import"]);
			}),
		testTimeout,
	);

	it.effect(
		"waits for a population still running",
		() =>
			Effect.gen(function* () {
				let reads = 0;
				const harness = makeHarness({ ready: () => (reads += 1) > 2 });
				const fiber = yield* Effect.forkChild(harness.run("slow-import"));
				yield* TestClock.adjust("1 second");
				yield* TestClock.adjust("1 second");
				yield* Fiber.join(fiber);

				expect(reads).toBe(3);
				expect(yield* outcomeOf(harness.stored, "slow-import")).toMatchObject({
					_tag: "completed",
				});
			}),
		testTimeout,
	);

	it.effect(
		"records the requested entry event after the import completes",
		() =>
			Effect.gen(function* () {
				const harness = makeHarness();
				yield* harness.run("entry-event-import", 1, true);

				expect(harness.calls.map(({ name }) => name)).toEqual([
					"population",
					"completion",
					"entry-event",
				]);
				expect(harness.calls[2]?.options).toMatchObject({
					userId,
					payload: [{ properties: {}, entityId: entity.id, eventSchemaSlug: "planned" }],
					command: {
						writeContext: null,
						causation: { executionId: "entry-event-import" },
						itemIdentity: stableStringify(["provider-import:entry-event-import", "entry-event"]),
					},
				});
			}),
		testTimeout,
	);

	it.effect(
		"does not repeat the entry event on a retried attempt",
		() =>
			Effect.gen(function* () {
				const harness = makeHarness();
				yield* harness.run("retried-import", 1, true);
				yield* harness.run("retried-import", 2, true);

				expect(harness.calls.filter(({ name }) => name === "entry-event")).toHaveLength(1);
			}),
		testTimeout,
	);

	it.effect(
		"stores a failure at the entry-event stage when the event is refused",
		() =>
			Effect.gen(function* () {
				const harness = makeHarness({
					eventResult: { failure: { index: 0, reason: { code: "invalid-properties" } } },
				});
				yield* harness.run("refused-import", 1, true);

				expect(yield* outcomeOf(harness.stored, "refused-import")).toEqual({
					_tag: "failed",
					stage: "entry-event",
					message: "invalid-properties",
				});
				expect(harness.released).toEqual(["refused-import"]);
			}),
		testTimeout,
	);

	it.effect(
		"stores a failure at the automation stage when completion fails",
		() =>
			Effect.gen(function* () {
				const harness = makeHarness({
					completion: () =>
						Effect.fail(
							new SandboxRunError({ kind: "script-failure", message: "membership hook failed" }),
						),
				});
				yield* harness.run("failed-import");

				expect(yield* outcomeOf(harness.stored, "failed-import")).toEqual({
					_tag: "failed",
					message: "membership hook failed",
					stage: "provider-import-automation",
				});
			}),
		testTimeout,
	);

	it.effect(
		"leaves an import's cancellation in place when a running attempt finishes",
		() =>
			Effect.gen(function* () {
				const harness = makeHarness();
				harness.stored.set("entity-import-outcome/cancelled-import", '{"_tag":"cancelled"}');
				yield* harness.run("cancelled-import");

				expect(yield* outcomeOf(harness.stored, "cancelled-import")).toEqual({ _tag: "cancelled" });
			}),
		testTimeout,
	);
});
