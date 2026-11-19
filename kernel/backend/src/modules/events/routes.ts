import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import {
	EventBadRequest,
	type EventNotFound,
	EventsInternalError,
	type EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import { AutomationExecutionId, EventId, type UserId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rejectWithLoggedCause } from "#lib/domain/logged-rejection";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { type EventChange, eventChanges, eventCreateChanges } from "#modules/changes/changes";
import { toCreateEventsResponse } from "#modules/changes/outcomes";
import { ChangeSets } from "#modules/changes/service";

const apiCommand = Effect.fnUntraced(function* (userId: UserId) {
	return {
		...rootLifecycleCommand({
			source: "api",
			lane: "interactive",
			accountUserId: userId,
			itemIdentity: "events",
			initiator: { id: userId, kind: "user" },
			executionId: AutomationExecutionId.make(generateId()),
			occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
		}),
		writeContext: null,
	};
});

const commitEventChange = Effect.fnUntraced(
	function* (change: EventChange) {
		const user = yield* CurrentUser;
		const changes = yield* ChangeSets;
		const result = yield* changes.commit(
			eventChanges(user.id, [change]),
			yield* apiCommand(user.id),
		);
		return { eventId: result.committed.events[0]?.eventId ?? null };
	},
	Effect.catch(
		(
			error,
		): Effect.Effect<never, EventStale | EventNotFound | EventBadRequest | EventsInternalError> => {
			if (
				error._tag === "EventStale" ||
				error._tag === "EventNotFound" ||
				error._tag === "EventBadRequest"
			) {
				return Effect.fail(error);
			}
			if (error._tag === "DomainWriteConflict") {
				return Effect.fail(new EventBadRequest({ reason: { code: error.reason.code } }));
			}
			if (error._tag === "EventCreateItemError") {
				return rejectWithLoggedCause(
					new EventBadRequest({ reason: { code: "mutation-conflict" } }),
					`Event reference is not writable: ${error.reason.code}`,
				);
			}
			if (error._tag === "AutomationPolicyExecutionError") {
				return Effect.fail(new EventBadRequest({ reason: { code: "policy-execution-failed" } }));
			}
			return Effect.logError("event change failed", error).pipe(
				Effect.andThen(new EventsInternalError({ reason: { code: "unexpected-error" } })),
			);
		},
	),
);

export const EventsRoutesLive = HttpApiBuilder.group(AppContract, "events", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const changes = yield* ChangeSets;
				return yield* changes
					.commit(eventCreateChanges(user.id, payload), yield* apiCommand(user.id), {
						events: { independent: true },
					})
					.pipe(
						Effect.map((result) => toCreateEventsResponse(result.outcomes)),
						Effect.catch((error) =>
							Effect.logError("event creation failed", error).pipe(
								Effect.andThen(new EventsInternalError({ reason: { code: "unexpected-error" } })),
							),
						),
					);
			}),
		)
		.handle("update", ({ params, payload }) => {
			const eventId = EventId.make(params.eventId);
			const { expected, ...patch } = payload;
			return commitEventChange({
				kind: "update",
				itemIdentity: `event:${eventId}`,
				item: { patch, eventId, ...(expected === undefined ? {} : { expected }) },
			});
		})
		.handle("delete", ({ params }) => {
			const eventId = EventId.make(params.eventId);
			return commitEventChange({ eventId, kind: "delete", itemIdentity: `event:${eventId}` });
		}),
);
