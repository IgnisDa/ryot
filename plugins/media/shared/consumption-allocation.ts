import { Schema } from "@ryot-app/plugin-kit/effect";
import { CalendarDate } from "@ryot-app/plugin-kit/schema";

import { ConsumedItem, ConsumptionBasis, SourceProgress } from "./consumption";

const Nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const ConsumptionObservation = Schema.Struct({
	id: Schema.String,
	entityId: Schema.String,
	occurredAt: Schema.String,
	closesRun: Schema.Boolean,
	entitySchemaSlug: Schema.String,
	eventSchemaSlug: Schema.Literals(["progress", "complete", "item-complete", "dropped", "on_hold"]),
	automatic: Schema.optionalKey(
		Schema.Struct({
			sourceEventId: Schema.String,
			rule: Schema.Literals(["progress", "coverage"]),
		}),
	),
	properties: Schema.Struct({
		consumptionBasis: ConsumptionBasis,
		timeSpent: Schema.optionalKey(Nonnegative),
		sourceRun: Schema.optionalKey(Schema.String),
		mangaVolume: Schema.optionalKey(Nonnegative),
		animeEpisode: Schema.optionalKey(Nonnegative),
		mangaChapter: Schema.optionalKey(Nonnegative),
		consumedItem: Schema.optionalKey(ConsumedItem),
		progressPages: Schema.optionalKey(Nonnegative),
		calendarDate: Schema.optionalKey(CalendarDate),
		dateUnknown: Schema.optionalKey(Schema.Boolean),
		sourceProgress: Schema.optionalKey(SourceProgress),
		progressPercent: Schema.optionalKey(Nonnegative.check(Schema.isLessThanOrEqualTo(100))),
	}),
});
export type ConsumptionObservation = typeof ConsumptionObservation.Type;

export const consumptionMeasureUnits = [
	"minutes",
	"pages",
	"episodes",
	"chapters",
	"volumes",
] as const;
export const ConsumptionMeasureUnit = Schema.Literals(consumptionMeasureUnits);
export type ConsumptionMeasureUnit = typeof ConsumptionMeasureUnit.Type;

const RecordedAnchor = Schema.Struct({
	amount: Nonnegative,
	index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
});
const UnitAnchors = Schema.Struct({
	pages: RecordedAnchor,
	minutes: RecordedAnchor,
	volumes: RecordedAnchor,
	episodes: RecordedAnchor,
	chapters: RecordedAnchor,
});

export const ConsumptionRunPlan = Schema.Struct({ count: Schema.Int, anchors: UnitAnchors });
export type ConsumptionRunPlan = typeof ConsumptionRunPlan.Type;

const UnitAllocation = Schema.Struct({ recorded: Nonnegative, fraction: Nonnegative });
export const ConsumptionAllocationState = Schema.Struct({
	index: Schema.Int,
	units: Schema.Struct({
		pages: UnitAllocation,
		minutes: UnitAllocation,
		volumes: UnitAllocation,
		episodes: UnitAllocation,
		chapters: UnitAllocation,
	}),
});
export type ConsumptionAllocationState = typeof ConsumptionAllocationState.Type;

const ConsumptionAttribution = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("unknown") }),
	Schema.Struct({ value: CalendarDate, kind: Schema.Literal("date") }),
	Schema.Struct({ value: Schema.String, kind: Schema.Literal("instant") }),
]);

export const ConsumptionAllocation = Schema.Struct({
	eventId: Schema.String,
	titleCompletions: Schema.Int,
	episodeCompletions: Schema.Int,
	activeObservation: Schema.Boolean,
	attribution: ConsumptionAttribution,
	quantities: Schema.Array(
		Schema.Struct({
			recorded: Nonnegative,
			estimated: Nonnegative,
			missing: Schema.Boolean,
			unit: ConsumptionMeasureUnit,
			supersededEstimate: Schema.Boolean,
		}),
	).check(Schema.isMaxLength(5)),
});
export type ConsumptionAllocation = typeof ConsumptionAllocation.Type;

export const emptyConsumptionRunPlan = (): ConsumptionRunPlan => ({
	count: 0,
	anchors: {
		pages: { amount: 0, index: -1 },
		minutes: { amount: 0, index: -1 },
		volumes: { amount: 0, index: -1 },
		episodes: { amount: 0, index: -1 },
		chapters: { amount: 0, index: -1 },
	},
});

export const emptyConsumptionAllocationState = (): ConsumptionAllocationState => ({
	index: 0,
	units: {
		pages: { recorded: 0, fraction: 0 },
		minutes: { recorded: 0, fraction: 0 },
		volumes: { recorded: 0, fraction: 0 },
		episodes: { recorded: 0, fraction: 0 },
		chapters: { recorded: 0, fraction: 0 },
	},
});

const isParent = (observation: ConsumptionObservation) =>
	observation.entitySchemaSlug === "show" || observation.entitySchemaSlug === "podcast";

const recordedAmount = (observation: ConsumptionObservation, unit: ConsumptionMeasureUnit) => {
	if (observation.automatic !== undefined || isParent(observation)) {
		return undefined;
	}
	const fields = {
		volumes: undefined,
		minutes: observation.properties.timeSpent,
		pages: observation.properties.progressPages,
		episodes: observation.properties.animeEpisode,
		chapters: observation.properties.mangaChapter,
	};
	return fields[unit];
};

export const planConsumptionObservation = (
	plan: ConsumptionRunPlan,
	observation: ConsumptionObservation,
): ConsumptionRunPlan => {
	const anchors = { ...plan.anchors };
	for (const unit of consumptionMeasureUnits) {
		const amount = recordedAmount(observation, unit);
		if (amount !== undefined && amount >= anchors[unit].amount) {
			anchors[unit] = { amount, index: plan.count };
		}
	}
	return { anchors, count: plan.count + 1 };
};

const observationFraction = (observation: ConsumptionObservation, unit: ConsumptionMeasureUnit) => {
	if (
		observation.automatic !== undefined ||
		unit !== observation.properties.consumptionBasis.unit
	) {
		return undefined;
	}
	if (observation.eventSchemaSlug === "complete") {
		return 1;
	}
	if (observation.properties.progressPercent !== undefined) {
		return observation.properties.progressPercent / 100;
	}
	if (unit === "minutes") {
		return undefined;
	}
	const amount = recordedAmount(observation, unit);
	const total = observation.properties.consumptionBasis.total;
	return amount === undefined || total === undefined || total === 0 ? undefined : amount / total;
};

const attribution = (observation: ConsumptionObservation): ConsumptionAllocation["attribution"] => {
	if (observation.properties.dateUnknown === true) {
		return { kind: "unknown" };
	}
	if (observation.properties.calendarDate !== undefined) {
		return { kind: "date", value: observation.properties.calendarDate };
	}
	return { kind: "instant", value: observation.occurredAt };
};

export const allocateConsumptionObservation = (
	plan: ConsumptionRunPlan,
	state: ConsumptionAllocationState,
	observation: ConsumptionObservation,
): { readonly state: ConsumptionAllocationState; readonly allocation: ConsumptionAllocation } => {
	const quantities: ConsumptionAllocation["quantities"][number][] = [];
	const units = { ...state.units };
	const item =
		observation.eventSchemaSlug === "item-complete"
			? observation.properties.consumedItem
			: undefined;
	if (observation.eventSchemaSlug === "item-complete" && item === undefined) {
		throw new Error("Item occurrence is missing its identity");
	}
	let activeObservation = item !== undefined;
	if (!isParent(observation) && observation.automatic === undefined) {
		for (const unit of consumptionMeasureUnits) {
			const primary = unit === observation.properties.consumptionBasis.unit;
			if (item !== undefined && unit !== "minutes") {
				continue;
			}
			const anchor = plan.anchors[unit];
			if (!primary && anchor.index < 0) {
				continue;
			}
			const previous = state.units[unit];
			const amount = recordedAmount(observation, unit);
			const fraction = observationFraction(observation, unit);
			const recorded = amount === undefined ? 0 : Math.max(0, amount - previous.recorded);
			const measured = amount !== undefined;
			if (!measured && fraction === undefined) {
				continue;
			}
			const nextFraction =
				measured && unit !== "minutes" && recorded === 0
					? previous.fraction
					: Math.max(previous.fraction, fraction ?? 0);
			const increased = nextFraction > previous.fraction;
			const supersededEstimate = !measured && primary && increased && state.index <= anchor.index;
			let estimated = 0;
			let missing = false;
			if (!measured && primary && increased && !supersededEstimate) {
				const total = observation.properties.consumptionBasis.total;
				if ((unit === "minutes" && anchor.index >= 0) || total === undefined) {
					missing = true;
				} else {
					estimated = Math.max(
						0,
						nextFraction * total - Math.max(previous.fraction * total, previous.recorded),
					);
				}
			}
			activeObservation ||= recorded > 0 || increased;
			units[unit] = { fraction: nextFraction, recorded: Math.max(previous.recorded, amount ?? 0) };
			quantities.push({ unit, missing, recorded, estimated, supersededEstimate });
		}
	}
	if (item !== undefined) {
		quantities.push({
			recorded: 1,
			estimated: 0,
			missing: false,
			unit: item.unit,
			supersededEstimate: false,
		});
	}
	const complete = observation.eventSchemaSlug === "complete";
	const episode =
		observation.entitySchemaSlug === "show-episode" ||
		observation.entitySchemaSlug === "podcast-episode";
	return {
		state: { units, index: state.index + 1 },
		allocation: {
			quantities,
			activeObservation,
			eventId: observation.id,
			attribution: attribution(observation),
			titleCompletions: complete && !episode ? 1 : 0,
			episodeCompletions: complete && episode ? 1 : 0,
		},
	};
};

export const ConsumptionRunCursor = Schema.Struct({
	runKey: Schema.NullOr(Schema.String),
	closedBy: Schema.NullOr(Schema.String),
});
export type ConsumptionRunCursor = typeof ConsumptionRunCursor.Type;

export const consumptionRunForObservation = (
	cursor: ConsumptionRunCursor,
	observation: ConsumptionObservation,
): { readonly runKey: string; readonly cursor: ConsumptionRunCursor } => {
	if (observation.properties.sourceRun !== undefined) {
		return {
			cursor,
			runKey: JSON.stringify([observation.entityId, "source", observation.properties.sourceRun]),
		};
	}
	if (observation.eventSchemaSlug === "item-complete") {
		return { cursor, runKey: JSON.stringify([observation.entityId, "item", observation.id]) };
	}
	if (observation.automatic?.rule === "progress") {
		if (cursor.runKey === null || cursor.closedBy !== observation.automatic.sourceEventId) {
			throw new Error("Automatic completion has no matching retained run boundary");
		}
		return { cursor, runKey: cursor.runKey };
	}
	const runKey =
		cursor.runKey === null || cursor.closedBy !== null
			? JSON.stringify([observation.entityId, "event", observation.id])
			: cursor.runKey;
	return {
		runKey,
		cursor: {
			runKey,
			closedBy:
				observation.closesRun || observation.eventSchemaSlug === "complete" ? observation.id : null,
		},
	};
};
