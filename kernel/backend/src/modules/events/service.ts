import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type { CreateEventItem, EventCreateOrigin } from "@ryot/contract/modules/events/schemas";
import { EventsBadRequest } from "@ryot/contract/modules/events/schemas";
import type { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Match } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { enqueueEventCreate } from "./event-create-workflow";
import {
	EventsRepository,
	type EventIdentityInput,
	type UpdateEventEntityReferencesInput,
} from "./repository";

type EventCreateInput = {
	readonly userId: UserId;
	readonly executionId?: string;
	readonly source: EventCreateOrigin;
	readonly payload: ReadonlyArray<CreateEventItem>;
	readonly metadata?: {
		readonly importRunId?: ImportRunId;
		readonly integrationId?: IntegrationId;
	};
};

const toLifecycleOrigin = (input: EventCreateInput): AutomationOrigin | undefined => {
	const importRunId = input.metadata?.importRunId;
	const integrationId = input.metadata?.integrationId;
	return Match.value(input.source).pipe(
		Match.when("api", () => ({ kind: "api" }) as const),
		Match.when(
			"import",
			() => ({ kind: "import", ...(importRunId ? { importRunId } : {}) }) as const,
		),
		Match.when("integration", () =>
			integrationId
				? ({ kind: "integration", integrationId, ...(importRunId ? { importRunId } : {}) } as const)
				: undefined,
		),
		Match.when("sandbox", () =>
			input.executionId
				? ({ kind: "automation", executionId: input.executionId } as const)
				: undefined,
		),
		Match.orElse(() => undefined),
	);
};

export class EventsService extends Context.Service<EventsService>()("EventsService", {
	make: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const repository = yield* EventsRepository;

		const provideWorkflowEngine = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(Effect.provideService(WorkflowEngine, engine));

		const create = Effect.fn("EventsService.create")(function* (input: EventCreateInput) {
			if (input.payload.length === 0) {
				return { count: 0, outcomes: [], failure: null };
			}

			if (input.source === "integration" && !input.metadata?.integrationId) {
				return yield* new EventsBadRequest({ reason: { code: "integration-id-required" } });
			}

			return yield* provideWorkflowEngine(
				enqueueEventCreate({
					userId: input.userId,
					origin: input.source,
					payload: input.payload,
					executionId: input.executionId,
					importRunId: input.metadata?.importRunId,
					lifecycleOrigin: toLifecycleOrigin(input),
					integrationId: input.metadata?.integrationId,
				}),
			);
		});

		const update = Effect.fn("EventsService.update")(function* (
			input: UpdateEventEntityReferencesInput,
		) {
			return yield* repository.updateEventEntityReferences(input);
		});

		const deleteEvent = Effect.fn("EventsService.delete")(function* (input: EventIdentityInput) {
			return yield* repository.deleteEvent(input);
		});

		return { create, delete: deleteEvent, update };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
