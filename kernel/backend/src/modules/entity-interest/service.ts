import { badRequest, notFound } from "@ryot/contract/errors";
import type { EntityInterestEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { Context, Effect, Layer } from "effect";

import { MAX_ROOT_PAGE_SIZE } from "#modules/ryotql/validator";

import { InterestReconciler, type InterestPrincipal } from "./reconciler";
import { EntityInterestStore, type PendingInterest } from "./store";

const chunk = <T>(items: readonly T[], size: number) => {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
};

export type ReconciledCompletion = {
	readonly pending: PendingInterest;
	readonly message: EntityInterestEntityUpdatedMessage;
};

export class InterestService extends Context.Service<InterestService>()("InterestService", {
	make: Effect.gen(function* () {
		const store = yield* EntityInterestStore;
		const reconciler = yield* InterestReconciler;

		const reconcile = Effect.fn("InterestService.reconcile")(function* (input: {
			readonly sessionId: string;
			readonly principal: InterestPrincipal;
			readonly pending: readonly PendingInterest[];
		}) {
			const terminal: ReconciledCompletion[] = [];
			for (const pending of chunk(input.pending, MAX_ROOT_PAGE_SIZE)) {
				const result = yield* reconciler.reconcile(
					input.principal,
					pending.map(({ entityId }) => entityId),
				);
				const visibleIds = new Set<string>(result.reconciledEntityIds);
				const visible = pending.filter(({ entityId }) => visibleIds.has(entityId));
				yield* store.removePending({
					sessionId: input.sessionId,
					pending: pending.filter(({ entityId }) => !visibleIds.has(entityId)),
				});
				const terminalIds = new Set<string>(result.terminal.map(({ entityId }) => entityId));
				yield* store.markReconciled({
					sessionId: input.sessionId,
					pending: visible.filter(({ entityId }) => !terminalIds.has(entityId)),
				});
				const pendingById = new Map(visible.map((item) => [item.entityId, item]));
				for (const update of result.terminal) {
					const current = pendingById.get(update.entityId);
					if (current !== undefined) {
						terminal.push({ pending: current, message: { type: "entity-updated", ...update } });
					}
				}
			}
			return terminal;
		});

		const setEntityInterestMembership = Effect.fn("InterestService.setEntityInterestMembership")(
			function* (input: { readonly sessionId: string; readonly entityIds: readonly string[] }) {
				const [metadata] = yield* store.getSessionMetadata([input.sessionId]);
				if (metadata === undefined) {
					return yield* notFound("Unknown session");
				}
				const result = yield* store.replaceInterest({
					entityIds: input.entityIds,
					sessionId: input.sessionId,
					revision: metadata.revision + 1,
				});
				if (result.status === "missing-session") {
					return yield* notFound("Unknown session");
				}
				if (result.status !== "applied") {
					return yield* badRequest(
						result.status === "limit-exceeded"
							? "Entity interest limit exceeded"
							: "Entity interest membership changed concurrently",
					);
				}
				yield* store.markReconciled({ sessionId: input.sessionId, pending: result.pending });
				return undefined;
			},
		);

		return { reconcile, setEntityInterestMembership };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
