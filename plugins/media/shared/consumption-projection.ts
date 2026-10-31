import { Schema } from "@ryot-app/plugin-kit/effect";

import {
	ConsumptionAllocation,
	ConsumptionAllocationState,
	ConsumptionRunCursor,
	ConsumptionRunPlan,
	emptyConsumptionAllocationState,
	emptyConsumptionRunPlan,
} from "./consumption-allocation";

const Measure = Schema.Struct({
	recorded: Schema.Finite,
	missing: Schema.Boolean,
	estimated: Schema.Finite,
	supersededEstimate: Schema.Boolean,
});
export const ConsumptionContribution = Schema.Struct({
	titleCompletions: Schema.Int,
	episodeCompletions: Schema.Int,
	activeObservation: Schema.Boolean,
	pages: Schema.optionalKey(Measure),
	minutes: Schema.optionalKey(Measure),
	volumes: Schema.optionalKey(Measure),
	episodes: Schema.optionalKey(Measure),
	chapters: Schema.optionalKey(Measure),
	attribution: ConsumptionAllocation.fields.attribution,
});
export const consumptionContribution = (
	allocation: ConsumptionAllocation,
): typeof ConsumptionContribution.Type => ({
	attribution: allocation.attribution,
	titleCompletions: allocation.titleCompletions,
	activeObservation: allocation.activeObservation,
	episodeCompletions: allocation.episodeCompletions,
	...Object.fromEntries(allocation.quantities.map(({ unit, ...measure }) => [unit, measure])),
});

export const consumptionEventSlugs = [
	"progress",
	"complete",
	"item-complete",
	"dropped",
	"on_hold",
] as const;

export const ConsumptionPosition = Schema.Struct({
	id: Schema.String,
	group: Schema.String,
	orderKey: Schema.String,
	occurredAt: Schema.String,
	orderCreatedAt: Schema.String,
});
export type ConsumptionPosition = typeof ConsumptionPosition.Type;

export const ConsumptionCheckpoint = Schema.Struct({
	plan: ConsumptionRunPlan,
	cursor: ConsumptionRunCursor,
	runKey: Schema.NullOr(Schema.String),
	allocation: ConsumptionAllocationState,
	after: Schema.NullOr(ConsumptionPosition),
	start: Schema.NullOr(ConsumptionPosition),
	phase: Schema.Literals(["plan", "replay"]),
});
export type ConsumptionCheckpoint = typeof ConsumptionCheckpoint.Type;

export const initialConsumptionCheckpoint = (
	after: ConsumptionCheckpoint["after"] = null,
	cursor: ConsumptionCheckpoint["cursor"] = { runKey: null, closedBy: null },
): ConsumptionCheckpoint => ({
	after,
	cursor,
	start: after,
	runKey: null,
	phase: "plan",
	plan: emptyConsumptionRunPlan(),
	allocation: emptyConsumptionAllocationState(),
});
