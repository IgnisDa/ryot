import type { DbError } from "@ryot-app/contract/errors";
import {
	AutomationBlockedReason,
	type LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { SignalSchemaReference } from "@ryot-app/contract/modules/plugins/references";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Schema } from "effect";

import { ChangeSets } from "#modules/changes/service";
import type { WriteTransaction } from "#platform/db/write-transaction";

import type { LifecyclePlan } from "./lifecycle/planning";

/**
 * The durable state that decides whether a signal commits: `check` is the commit's precondition, and
 * `record` stores the planned signal in the commit transaction.
 */
type KernelSignalLedger = {
	readonly record: (plan: LifecyclePlan) => Effect.Effect<void, DbError>;
	readonly check: (transaction: WriteTransaction) => Effect.Effect<boolean, DbError>;
};

/** A ledger's signal was blocked: nothing committed, so the ledger tries it again later. */
export class KernelSignalBlocked extends Schema.TaggedError<
	KernelSignalBlocked,
	{ readonly brand: unique symbol }
>()("KernelSignalBlocked", { reason: AutomationBlockedReason }) {}

export class KernelSignals extends Context.Service<KernelSignals>()(
	"@ryot-app/kernel-backend/modules/automations/kernel-signals/KernelSignals",
	{
		make: Effect.gen(function* () {
			const changeSets = yield* ChangeSets;
			/**
			 * Commits one signal the kernel emits under `userId`'s principal. A ledger records it only when
			 * its trigger is not blocked; a blocked one fails the commit with `KernelSignalBlocked`.
			 */
			const commit = Effect.fn("KernelSignals.commit")(function* (input: {
				readonly userId: UserId;
				readonly properties: unknown;
				readonly command: LifecycleCommand;
				readonly subjectEntityId?: EntityId;
				readonly ledger?: KernelSignalLedger;
				readonly reference: SignalSchemaReference;
			}) {
				const { ledger, userId } = input;
				yield* changeSets.commit(
					{
						userId,
						signals: [
							{
								itemIdentity: "signal",
								reference: input.reference,
								properties: input.properties,
								principal: { userId, kind: "user" },
								...(input.subjectEntityId === undefined
									? {}
									: { subjectEntityId: input.subjectEntityId }),
							},
						],
					},
					{ ...input.command, writeContext: null },
					ledger === undefined
						? {}
						: {
								precondition: {
									check: ledger.check,
									written: Effect.fnUntraced(function* (result) {
										const [signal] = result.signals;
										if (signal === undefined) {
											return yield* Effect.die("A kernel signal committed without its plan");
										}
										const { blockedReason } = signal.plan.trigger;
										if (blockedReason !== null) {
											return yield* new KernelSignalBlocked({ reason: blockedReason });
										}
										return yield* ledger.record(signal.plan);
									}),
								},
							},
				);
			});
			return { commit };
		}),
	},
) {}
