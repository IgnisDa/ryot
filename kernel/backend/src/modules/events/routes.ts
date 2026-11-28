import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import type { PolicyFailure } from "@ryot-app/contract/modules/changes/policies";
import {
	EventBadRequest,
	type EventNotFound,
	EventsInternalError,
	type EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import { EventId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rejectWithLoggedCause } from "#lib/domain/logged-rejection";
import { apiLifecycleCommand } from "#modules/automations/lifecycle/api-command";
import { type EventChange, eventChanges, eventCreateChanges } from "#modules/changes/changes";
import { toCreateEventsResponse } from "#modules/changes/outcomes";
import { ChangeSets } from "#modules/changes/service";

const commitEventChange = Effect.fnUntraced(
	function* (change: EventChange) {
		const user = yield* CurrentUser;
		const changes = yield* ChangeSets;
		const result = yield* changes.commit(
			eventChanges(user.id, [change]),
			yield* apiLifecycleCommand(user, "events"),
		);
		return { eventId: result.committed.events[0]?.eventId ?? null };
	},
	Effect.catch(
		(
			error,
		): Effect.Effect<
			never,
			EventStale | EventNotFound | PolicyFailure | EventBadRequest | EventsInternalError
		> => {
			if (
				error._tag === "EventStale" ||
				error._tag === "EventNotFound" ||
				error._tag === "EventBadRequest" ||
				error._tag === "PolicyRejected" ||
				error._tag === "PolicyUnavailable"
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
					.commit(
						eventCreateChanges(user.id, payload),
						yield* apiLifecycleCommand(user, "events"),
						{ events: { independent: true } },
					)
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
