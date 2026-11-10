import { Schema } from "@ryot-app/plugin-kit/effect";

import { isPositional } from "./media-schema-slugs";

export const ConsumptionUnit = Schema.Literals(["minutes", "pages", "episodes", "chapters"]);
export type ConsumptionUnit = typeof ConsumptionUnit.Type;

export const ConsumptionBasisProperty = Schema.Literals([
	"runtime",
	"duration",
	"lengthMinutes",
	"pages",
	"episodes",
	"chapters",
]);

export const ConsumptionBasis = Schema.Struct({
	unit: ConsumptionUnit,
	property: Schema.optionalKey(ConsumptionBasisProperty),
	total: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ConsumptionBasis = typeof ConsumptionBasis.Type;

/** Days a source `calendarDate` may differ from the UTC date of the event's `occurredAt`. */
export const CALENDAR_DATE_TOLERANCE_DAYS = 1;

export const MediaPositionUnit = Schema.Literals(["episodes", "chapters", "volumes"]);
export type MediaPositionUnit = typeof MediaPositionUnit.Type;

const Nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const MediaPosition = Schema.Struct({
	position: Nonnegative,
	unit: MediaPositionUnit,
	volume: Schema.optionalKey(Nonnegative),
});
export type MediaPosition = typeof MediaPosition.Type;

export const SourceProgress = Schema.Struct({
	...MediaPosition.fields,
	percent: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
});

const cumulativePositionEvents = new Set(["dropped", "on_hold", "progress"]);

/** Cumulative Manga positions count chapters; an item, snapshot or review may name a volume. */
export const mediaPositionUnits = (
	entitySchemaSlug: "anime" | "manga",
	eventSchemaSlug: string,
): readonly MediaPositionUnit[] => {
	if (entitySchemaSlug === "anime") {
		return ["episodes"];
	}
	return cumulativePositionEvents.has(eventSchemaSlug) ? ["chapters"] : ["chapters", "volumes"];
};

export const hasStrayVolume = (position: Pick<MediaPosition, "unit" | "volume">) =>
	position.volume !== undefined && position.unit !== "chapters";

export const mediaPositionError = (
	entitySchemaSlug: string,
	eventSchemaSlug: string,
	position: MediaPosition,
) => {
	if (
		!isPositional(entitySchemaSlug) ||
		!mediaPositionUnits(entitySchemaSlug, eventSchemaSlug).includes(position.unit)
	) {
		return "This media type does not track this position";
	}
	if (position.unit === "episodes" && !Number.isInteger(position.position)) {
		return "Episode numbers are whole numbers";
	}
	return hasStrayVolume(position) ? "Volume context belongs to a chapter position" : undefined;
};

export const sameMediaPosition = (
	left: undefined | MediaPosition,
	right: undefined | MediaPosition,
) =>
	left?.unit === right?.unit &&
	left?.position === right?.position &&
	left?.volume === right?.volume;

type ConsumptionBasisRule = {
	readonly divisor?: number;
	readonly unit: ConsumptionUnit;
	readonly property?: typeof ConsumptionBasisProperty.Type;
};

export const defaultConsumptionBasisRule: ConsumptionBasisRule = {
	unit: "minutes",
	property: "runtime",
};

export const consumptionBasisRules: ReadonlyMap<string, ConsumptionBasisRule> = new Map([
	["show", { unit: "episodes" }],
	["podcast", { unit: "episodes" }],
	["video-game", { unit: "minutes" }],
	["book", { unit: "pages", property: "pages" }],
	["comic-book", { unit: "pages", property: "pages" }],
	["anime", { unit: "episodes", property: "episodes" }],
	["manga", { unit: "chapters", property: "chapters" }],
	["visual-novel", { unit: "minutes", property: "lengthMinutes" }],
	["music", { divisor: 60, unit: "minutes", property: "duration" }],
]);

export const consumptionBasisFor = (
	slug: string,
	properties: Readonly<Record<string, unknown>>,
): ConsumptionBasis => {
	const {
		unit,
		property,
		divisor = 1,
	} = consumptionBasisRules.get(slug) ?? defaultConsumptionBasisRule;
	const value = property === undefined ? undefined : properties[property];
	return {
		unit,
		...(property === undefined ? {} : { property }),
		...(typeof value === "number" && Number.isFinite(value) && value >= 0
			? { total: value / divisor }
			: {}),
	};
};
