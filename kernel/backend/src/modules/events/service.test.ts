import { expect, it } from "@effect/vitest";
import {
	AutomationExecutionId,
	EntityId,
	EventSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { makeWorkflowEngine } from "#lib/test-utils/effect";

import { EventsRepository } from "./repository";
import { EventsService } from "./service";

it.effect("awaits the owning workflow and preserves command causation and identity", () => {
	const calls: unknown[] = [];
	const userId = UserId.make("user");
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
	const result = { count: 0, outcomes: [], warnings: [], failure: null };
	const layer = EventsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.mock(EventsRepository)({}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						execute: (_workflow, options) => {
							calls.push(options);
							return Effect.succeed(result);
						},
					}),
				),
			),
		),
	);
	return Effect.gen(function* () {
		const service = yield* EventsService;
		expect(yield* service.create(input, command)).toEqual(result);
		expect(calls).toMatchObject([{ payload: { ...input, command } }]);
		expect(calls[0]).not.toHaveProperty("discard", true);
		expect(yield* service.create({ userId, payload: [] }, command)).toEqual(result);
		expect(calls).toHaveLength(1);
	}).pipe(Effect.provide(layer));
});
