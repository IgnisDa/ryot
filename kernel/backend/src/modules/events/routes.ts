import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { DbError } from "@ryot-app/contract/errors";
import { EventsInternalError } from "@ryot-app/contract/modules/events/schemas";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";

import { EventsService } from "./service";

export const EventsRoutesLive = HttpApiBuilder.group(AppContract, "events", (handlers) =>
	handlers.handle("create", ({ payload }) =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const service = yield* EventsService;
			const command = rootLifecycleCommand({
				source: "api",
				itemIdentity: "events",
				initiator: { id: user.id, kind: "user" },
				executionId: AutomationExecutionId.make(generateId()),
				occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
			});
			return yield* service.create({ payload, userId: user.id }, command).pipe(
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
	),
);
