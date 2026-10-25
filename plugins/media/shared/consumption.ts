import { Schema } from "@ryot-app/plugin-kit/effect";

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

export const ConsumedItemUnit = Schema.Literals(["episodes", "chapters", "volumes"]);

export const ConsumedItem = Schema.Struct({
	unit: ConsumedItemUnit,
	position: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	volume: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ConsumedItem = typeof ConsumedItem.Type;

export const SourceProgress = Schema.Struct({
	unit: ConsumedItemUnit,
	position: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	percent: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
});

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
