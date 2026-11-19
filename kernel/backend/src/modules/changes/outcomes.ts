import {
	type CreateEventsResponse,
	EventCreateFailureReason,
	EventCreateItemOutcome,
} from "@ryot-app/contract/modules/events/schemas";
import { Schema } from "effect";

import type { PolicyBatchResult } from "#modules/automations/lifecycle/policies";

/** Nothing was committed: `kept` outcomes stand and every other item fails with `reason`. */
export class EventCreateRejected extends Schema.TaggedError<
	EventCreateRejected,
	{ readonly brand: unique symbol }
>()("EventCreateRejected", {
	reason: EventCreateFailureReason,
	kept: Schema.Array(EventCreateItemOutcome),
}) {}

export const policyOutcomes = (
	validated: PolicyBatchResult,
	indexOf: (itemIdentity: string) => number,
) => {
	const outcomes: EventCreateItemOutcome[] = [];
	for (const item of validated.items) {
		if (item.rejected !== null) {
			outcomes.push({
				reason: item.rejected,
				status: "skipped_by_policy",
				index: indexOf(item.itemIdentity),
			});
		}
		if (item.error !== null) {
			const reason: EventCreateFailureReason =
				item.error.code === "reference-not-found" && item.error.entityId !== undefined
					? { entityId: item.error.entityId, code: "session-entity-not-found" }
					: { code: "invalid-properties" };
			outcomes.push({ reason, status: "failed", index: indexOf(item.itemIdentity) });
		}
	}
	const accepted = new Set(
		validated.items
			.filter((item) => item.rejected === null && item.error === null)
			.map((item) => item.itemIdentity),
	);
	return { outcomes, accepted };
};

/** Every item without a kept outcome fails with the rejection's reason. */
export const rejectedOutcomes = (rejection: EventCreateRejected, count: number) => {
	const settled = new Set(rejection.kept.map((outcome) => outcome.index));
	return sortedOutcomes([
		...rejection.kept,
		...Array.from({ length: count }, (_, index) => index).flatMap((index) =>
			settled.has(index) ? [] : [{ index, reason: rejection.reason, status: "failed" as const }],
		),
	]);
};

export const sortedOutcomes = (outcomes: ReadonlyArray<EventCreateItemOutcome>) =>
	[...outcomes].sort((left, right) => left.index - right.index);

export const toCreateEventsResponse = (
	outcomes: ReadonlyArray<EventCreateItemOutcome>,
): CreateEventsResponse => {
	const failed = outcomes.find((outcome) => outcome.status === "failed");
	return {
		outcomes,
		failure: failed ? { index: failed.index, reason: failed.reason } : null,
		count: outcomes.filter((outcome) => outcome.status === "written").length,
	};
};

export const commitRejection = (error: {
	readonly _tag: string;
	readonly reason?: unknown;
}): EventCreateFailureReason => {
	if (error._tag === "EventReferenceUnavailable") {
		return { code: "invalid-properties" };
	}
	return {
		code:
			error._tag === "EventBadRequest" &&
			typeof error.reason === "object" &&
			error.reason !== null &&
			"code" in error.reason &&
			error.reason.code === "asset-forbidden"
				? "asset-forbidden"
				: "mutation-conflict",
	};
};
