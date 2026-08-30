import { expect, layer } from "@effect/vitest";
import {
	AutomationExecutionId,
	EntityId,
	EventSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeWorkflowEngine } from "#lib/test-utils/effect";

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
				execute: (_workflow, options) =>
					Ref.update(executions, (all) => [...all, options]).pipe(Effect.as(result)),
			}),
		).pipe(Context.add(WorkflowExecutions, Ref.get(executions)));
	}),
);

const serviceLayer = EventsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.mock(EventsRepository)({}),
			Layer.mock(DatabaseSession)({ requireRoot: Effect.void }),
			Layer.mock(LifecyclePlanner)({}),
			Layer.mock(LifecycleExecution)({}),
		),
	),
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
});
