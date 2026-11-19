import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { EventNotFound, EventsInternalError } from "@ryot-app/contract/modules/events/schemas";
import { AutomationExecutionId, EventId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { eventCreateChanges } from "#modules/changes/changes";
import { toCreateEventsResponse } from "#modules/changes/outcomes";
import { ChangeSets } from "#modules/changes/service";

import { EventsService } from "./service";

export const EventsRoutesLive = HttpApiBuilder.group(AppContract, "events", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const changes = yield* ChangeSets;
				const command = {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						itemIdentity: "events",
						accountUserId: user.id,
						initiator: { id: user.id, kind: "user" },
						executionId: AutomationExecutionId.make(generateId()),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					}),
					writeContext: null,
				};
				return yield* changes
					.commit(eventCreateChanges(user.id, payload), command, { events: { independent: true } })
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
		.handle("update", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EventsService;
				const eventId = EventId.make(params.eventId);
				const { expected, ...patch } = payload;
				const command = {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						accountUserId: user.id,
						itemIdentity: `event:${eventId}:edit`,
						initiator: { id: user.id, kind: "user" },
						executionId: AutomationExecutionId.make(generateId()),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					}),
					writeContext: null,
				};
				return yield* service
					.edit(
						{ patch, eventId, ...(expected === undefined ? {} : { expected }) },
						user.id,
						command,
					)
					.pipe(
						Effect.catchTag("DbError", (error) =>
							Effect.logError("event update failed", error).pipe(
								Effect.andThen(new EventsInternalError({ reason: { code: "unexpected-error" } })),
							),
						),
					);
			}),
		)
		.handle("delete", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EventsService;
				const eventId = EventId.make(params.eventId);
				const command = {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						accountUserId: user.id,
						itemIdentity: `event:${eventId}:delete`,
						initiator: { id: user.id, kind: "user" },
						executionId: AutomationExecutionId.make(generateId()),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					}),
					writeContext: null,
				};
				return yield* service.delete({ eventId, userId: user.id }, command).pipe(
					Effect.filterOrFail(
						(result) => result.eventId !== null,
						() => new EventNotFound({ reason: { eventId, code: "event-not-found" } }),
					),
					Effect.catchTag("DbError", (error) =>
						Effect.logError("event deletion failed", error).pipe(
							Effect.andThen(new EventsInternalError({ reason: { code: "unexpected-error" } })),
						),
					),
				);
			}),
		),
);
