import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth-middleware";
import { AppContract } from "#lib/contract";

import { StreamRegistry } from "./registry";
import { InterestReconciler } from "./service";
import { buildInterestStreamResponse } from "./stream";

export const InterestRoutesLive = HttpApiBuilder.group(AppContract, "interest", (handlers) =>
	handlers
		.handleRaw("stream", ({ urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const registry = yield* StreamRegistry;
				return buildInterestStreamResponse(urlParams.streamId, user.id, registry);
			}),
		)
		.handle("declareInterest", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const registry = yield* StreamRegistry;
				const reconciler = yield* InterestReconciler;

				// Register interest BEFORE the reconcile read: a workflow that publishes mid-reconcile
				// must still find this stream in the registry.
				yield* registry.setInterestIfOwner(payload.streamId, user.id, payload.entityIds);

				const terminal = yield* reconciler
					.reconcile(user, payload.entityIds)
					.pipe(
						Effect.catchAll((error) =>
							Effect.logWarning("Interest reconcile failed", error).pipe(Effect.as([])),
						),
					);

				// Gate on the stream's current interest: a newer interest POST processed while this one
				// awaited reconcile may have dropped some ids under replace semantics.
				return {
					terminal: terminal.filter((update) =>
						registry.hasInterest(payload.streamId, update.entityId),
					),
				};
			}),
		),
);
