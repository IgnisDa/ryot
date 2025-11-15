import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth-middleware";
import { AppContract } from "#lib/contract";

import { MAX_INTEREST_ENTITY_IDS } from "./messages";
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

				// Bound the interest set so one POST cannot hold a DB connection across ⌈N/100⌉ sequential
				// reconcile transactions. Truncate + log rather than reject, so an oversized (but legit)
				// saved view still gets partial updates.
				const entityIds = payload.entityIds.slice(0, MAX_INTEREST_ENTITY_IDS);
				if (entityIds.length < payload.entityIds.length) {
					yield* Effect.logWarning("Interest set truncated", {
						cap: MAX_INTEREST_ENTITY_IDS,
						streamId: payload.streamId,
						declared: payload.entityIds.length,
					});
				}

				// Register interest BEFORE the reconcile read: a workflow that publishes mid-reconcile
				// must still find this stream in the registry.
				yield* registry.setInterestIfOwner(payload.streamId, user.id, entityIds);

				const terminal = yield* reconciler
					.reconcile(user, entityIds)
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
