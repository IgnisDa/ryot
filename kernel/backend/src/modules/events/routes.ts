import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { DbError } from "@ryot-app/contract/errors";
import { EventNotFound, EventsInternalError } from "@ryot-app/contract/modules/events/schemas";
import { AutomationExecutionId, EventId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";

import { EventsService } from "./service";

export const EventsRoutesLive = HttpApiBuilder.group(AppContract, "events", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EventsService;
				const command = rootLifecycleCommand({
					source: "api",
					itemIdentity: "events",
					initiator: { id: user.id, kind: "user" },
					accountGeneration: user.accountGeneration,
					executionId: AutomationExecutionId.make(generateId()),
					occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
				});
				return yield* service.createHttp({ payload, userId: user.id }, command).pipe(
					Effect.catchTag("EventCreateItemError", (error) =>
						Effect.logError("event creation escaped item failure handling", error).pipe(
							Effect.andThen(new EventsInternalError({ reason: { code: "unexpected-error" } })),
						),
					),
					Effect.catchIf(
						(error): error is DbError => error instanceof DbError,
						(error) =>
							Effect.logError("event creation failed", error).pipe(
								Effect.andThen(new EventsInternalError({ reason: { code: "unexpected-error" } })),
							),
					),
				);
			}),
		)
		.handle("getCreateOperation", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EventsService;
				return yield* service
					.getCreateOperation(user.id, params.operationId)
					.pipe(
						Effect.catchTag("DbError", (error) =>
							Effect.logError("event operation lookup failed", error).pipe(
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
				const command = rootLifecycleCommand({
					source: "api",
					itemIdentity: `event:${eventId}:edit`,
					initiator: { id: user.id, kind: "user" },
					accountGeneration: user.accountGeneration,
					executionId: AutomationExecutionId.make(generateId()),
					occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
				});
				return yield* service
					.edit({ eventId, patch: payload }, user.id, command)
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
				const command = rootLifecycleCommand({
					source: "api",
					itemIdentity: `event:${eventId}:delete`,
					initiator: { id: user.id, kind: "user" },
					accountGeneration: user.accountGeneration,
					executionId: AutomationExecutionId.make(generateId()),
					occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
				});
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
