import { assert, expect, layer } from "@effect/vitest";
import {
	AutomationExecutionId,
	EntityId,
	EventSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import { EventsRepository } from "./repository";
import { EventsService } from "./service";

const userId = UserId.make("user");
const result = { count: 0, outcomes: [], warnings: [], failure: null };

class WorkflowExecutions extends Context.Service<
	WorkflowExecutions,
	Effect.Effect<ReadonlyArray<unknown>>
>()("test/WorkflowExecutions") {}

const recordingWorkflowEngineLayer = Layer.effectContext(
	Effect.gen(function* () {
		const executions = yield* Ref.make<ReadonlyArray<unknown>>([]);
		return Context.make(
			WorkflowEngine,
			makeWorkflowEngine({
				poll: () => Effect.succeedSome(new Workflow.Suspended()),
				execute: (_workflow, options) =>
					Ref.update(executions, (all) => [...all, options]).pipe(Effect.as(result)),
			}),
		).pipe(Context.add(WorkflowExecutions, Ref.get(executions)));
	}),
);

const serviceLayer = EventsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.mock(EventsRepository)({
				getCreateProgress: () => Effect.succeed({ writtenCount: 1, requiredPending: true }),
			}),
			Layer.mock(EntitiesRepository)({}),
			Layer.mock(EventSchemasRepository)({}),
			mutationAdmissionTestLayer,
			Layer.mock(LifecyclePlanner)({}),
			Layer.mock(LifecycleExecution)({}),
		),
	),
	Layer.provide(makeAppConfigLayer()),
	Layer.provideMerge(recordingWorkflowEngineLayer),
);

layer(serviceLayer)((test) => {
	test.effect("awaits the owning workflow and preserves command causation and identity", () =>
		Effect.gen(function* () {
			const command = rootLifecycleCommand({
				source: "import",
				itemIdentity: "import:item",
				initiator: { id: userId, kind: "user" },
				executionId: AutomationExecutionId.make("import"),
				occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
				accountGeneration: { userId, token: "test-account-generation" },
			});
			const input = {
				userId,
				payload: [
					{
						properties: { rating: 1 },
						entityId: EntityId.make("entity"),
						eventSchemaSlug: EventSchemaSlug.make("rating"),
					},
				],
			};
			const service = yield* EventsService;
			const executions = yield* WorkflowExecutions;
			expect(yield* service.create(input, command)).toEqual(result);
			const calls = yield* executions;
			expect(calls).toMatchObject([{ payload: { ...input, command } }]);
			expect(calls[0]).not.toHaveProperty("discard", true);
			expect(yield* service.create({ userId, payload: [] }, command)).toEqual(result);
			expect(yield* executions).toHaveLength(1);
		}),
	);
	test.effect(
		"ends the HTTP wait after one command budget without abandoning a committed event",
		() =>
			Effect.gen(function* () {
				const command = rootLifecycleCommand({
					source: "api",
					itemIdentity: "events",
					initiator: { id: userId, kind: "user" },
					executionId: AutomationExecutionId.make("http-request"),
					occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
					accountGeneration: { userId, token: "test-account-generation" },
				});
				const service = yield* EventsService;
				const waiting = yield* service
					.createHttp(
						{
							userId,
							payload: [
								{
									properties: {},
									entityId: EntityId.make("entity"),
									eventSchemaSlug: EventSchemaSlug.make("rating"),
								},
							],
						},
						command,
					)
					.pipe(Effect.forkChild);
				yield* TestClock.adjust("35 seconds");
				const response = yield* Fiber.join(waiting);
				expect(response).toMatchObject({
					writtenCount: 1,
					writesPending: false,
					status: "committed-follow-up-pending",
				});
				assert("operationId" in response);
				expect(yield* service.getCreateOperation(userId, response.operationId)).toEqual(response);
				const denied = yield* Effect.flip(
					service.getCreateOperation(UserId.make("other"), response.operationId),
				);
				expect(denied._tag).toBe("EventOperationNotFound");
			}),
	);
});
