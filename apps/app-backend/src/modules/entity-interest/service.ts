import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	type DeclareInterestBody,
	MAX_INTEREST_ENTITY_IDS,
} from "@ryot/contract/modules/entity-interest/messages";
import type { UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { MAX_ROOT_PAGE_SIZE } from "#modules/ryotql/validator";

import { InterestReconciler } from "./reconciler";
import { EntityInterestStore } from "./store";

const chunk = <T>(items: readonly T[], size: number) => {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
};

export class InterestService extends Context.Service<InterestService>()("InterestService", {
	make: Effect.gen(function* () {
		const store = yield* EntityInterestStore;
		const reconciler = yield* InterestReconciler;

		const setInterest = Effect.fn("InterestService.setInterest")(function* (input: {
			userId: UserId;
			streamId: string;
			entityIds: readonly string[];
			preferredLanguage?: string | null;
		}) {
			const entityIds = input.entityIds.slice(0, MAX_INTEREST_ENTITY_IDS);
			if (entityIds.length < input.entityIds.length) {
				yield* Effect.logWarning("interest set truncated").pipe(
					Effect.annotateLogs({
						streamId: input.streamId,
						cap: MAX_INTEREST_ENTITY_IDS,
						declared: input.entityIds.length,
					}),
				);
			}
			return yield* store.replaceInterest({
				entityIds,
				userId: input.userId,
				streamId: input.streamId,
				preferredLanguage: input.preferredLanguage ?? null,
			});
		});

		const declareInterest = Effect.fn("InterestService.declareInterest")(function* (
			user: CurrentUserValue,
			payload: DeclareInterestBody,
		) {
			const { generation, pendingEntityIds } = yield* setInterest({
				userId: user.id,
				streamId: payload.streamId,
				entityIds: payload.entityIds,
				preferredLanguage: user.preferences.language,
			});
			const terminal = [];
			for (const entityIds of chunk(pendingEntityIds, MAX_ROOT_PAGE_SIZE)) {
				const result = yield* reconciler.reconcile(user, entityIds);
				const currentGeneration = yield* store.markReconciled({
					generation,
					streamId: payload.streamId,
					entityIds: result.reconciledEntityIds,
				});
				if (!currentGeneration) {
					break;
				}
				for (const update of result.terminal) {
					if (yield* store.hasInterest(payload.streamId, update.entityId)) {
						terminal.push(update);
					}
				}
			}
			return { terminal };
		});

		return { setInterest, declareInterest };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
