import { Schema } from "@ryot-app/plugin-kit/effect";

export const ConsumptionUnit = Schema.Literals(["minutes", "pages", "episodes", "chapters"]);
export type ConsumptionUnit = typeof ConsumptionUnit.Type;

export const ConsumptionBasis = Schema.Struct({
	unit: ConsumptionUnit,
	total: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
	property: Schema.optionalKey(
		Schema.Literals(["runtime", "duration", "lengthMinutes", "pages", "episodes", "chapters"]),
	),
});
export type ConsumptionBasis = typeof ConsumptionBasis.Type;

export const ConsumedItem = Schema.Struct({
	unit: Schema.Literals(["episodes", "chapters", "volumes"]),
	position: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	volume: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ConsumedItem = typeof ConsumedItem.Type;

export const SourceProgress = Schema.Struct({
	unit: Schema.Literals(["episodes", "chapters", "volumes"]),
	position: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	percent: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
});

export const ConsumptionCalendarDate = Schema.String.check(
	Schema.makeFilter((value) => {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			return false;
		}
		const date = new Date(`${value}T00:00:00.000Z`);
		return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
	}),
);

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

export const consumptionFactKeys = [
	"consumptionBasis",
	"calendarDate",
	"progressPages",
	"sourceRun",
	"sourceProgress",
	"consumedItem",
] as const;

export const consumptionPropertiesEqual = (left: unknown, right: unknown): boolean => {
	if (left === right) {
		return true;
	}
	if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => consumptionPropertiesEqual(value, right[index]))
		);
	}
	const a = Object.entries(left);
	const b = Object.entries(right);
	return (
		a.length === b.length &&
		a.every(([key, value]) => {
			const entry = b.find(([candidate]) => candidate === key);
			return entry !== undefined && consumptionPropertiesEqual(value, entry[1]);
		})
	);
};
