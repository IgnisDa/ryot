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

export const consumptionBasisFor = (
	slug: string,
	properties: Readonly<Record<string, unknown>>,
): ConsumptionBasis => {
	const basis = (unit: ConsumptionUnit, property: ConsumptionBasis["property"], divisor = 1) => {
		const value = property === undefined ? undefined : properties[property];
		return {
			unit,
			...(property === undefined ? {} : { property }),
			...(typeof value === "number" && Number.isFinite(value) && value >= 0
				? { total: value / divisor }
				: {}),
		};
	};
	switch (slug) {
		case "book":
		case "comic-book":
			return basis("pages", "pages");
		case "show":
		case "podcast":
			return basis("episodes", undefined);
		case "anime":
			return basis("episodes", "episodes");
		case "manga":
			return basis("chapters", "chapters");
		case "music":
			return basis("minutes", "duration", 60);
		case "video-game":
			return basis("minutes", undefined);
		case "visual-novel":
			return basis("minutes", "lengthMinutes");
		default:
			return basis("minutes", "runtime");
	}
};
