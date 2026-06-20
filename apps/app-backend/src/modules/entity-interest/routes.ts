import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { MAX_INTEREST_ENTITY_IDS } from "@ryot/contract/modules/entity-interest/messages";
import { Effect } from "effect";

import { StreamRegistry } from "./registry";
import { InterestReconciler } from "./service";
import { buildInterestStreamResponse } from "./stream";

export const InterestRoutesLive = HttpApiBuilder.group(AppContract, "entity-interest", (handlers) =>
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

				const entityIds = payload.entityIds.slice(0, MAX_INTEREST_ENTITY_IDS);
				if (entityIds.length < payload.entityIds.length) {
					yield* Effect.logWarning("Interest set truncated", {
						cap: MAX_INTEREST_ENTITY_IDS,
						streamId: payload.streamId,
						declared: payload.entityIds.length,
					});
				}

				yield* registry.setInterestIfOwner(payload.streamId, user.id, entityIds);

				const terminal = yield* reconciler
					.reconcile(user, entityIds)
					.pipe(
						Effect.catchAll((error) =>
							Effect.logWarning("Interest reconcile failed", error).pipe(Effect.as([])),
						),
					);

				return {
					terminal: terminal.filter((update) =>
						registry.hasInterest(payload.streamId, update.entityId),
					),
				};
			}),
		),
);
