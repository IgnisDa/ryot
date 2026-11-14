import { Schema } from "effect";

import { roundHalfUp } from "../../schema/numeric-normalization";

export const RatingScale = Schema.Literals(["hundred", "ten", "five", "three-point"]);
export type RatingScale = typeof RatingScale.Type;

export const ratingScales = {
	five: { max: 5, step: 0.5, input: "stars" },
	ten: { max: 10, step: 0.1, input: "number" },
	hundred: { step: 1, max: 100, input: "number" },
	"three-point": { max: 2, step: 1, input: "choices" },
} as const satisfies Record<
	RatingScale,
	{ readonly max: number; readonly step: number; readonly input: "stars" | "number" | "choices" }
>;

export const threePointRatings = ["Sad", "Neutral", "Happy"] as const;

const threePointFloors = [0, 100 / 3, 200 / 3] as const;
const threePointCeilings = [100 / 3, 200 / 3, 100] as const;

const storedPerPoint = (scale: RatingScale) => 100 / ratingScales[scale].max;

const threePointIndex = (rating: number): 0 | 1 | 2 => {
	if (rating < threePointFloors[1]) {
		return 0;
	}
	return rating < threePointFloors[2] ? 1 : 2;
};

export const toScale = (rating: number, scale: RatingScale) =>
	scale === "three-point" ? threePointIndex(rating) : rating / storedPerPoint(scale);

export const fromScale = (value: number, scale: RatingScale) =>
	roundHalfUp(value * storedPerPoint(scale), 6);

const hundredFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const tenthsFormat = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});

export const formatRating = (rating: number, scale: RatingScale) => {
	if (scale === "three-point") {
		return threePointRatings[threePointIndex(rating)];
	}
	return (scale === "hundred" ? hundredFormat : tenthsFormat).format(toScale(rating, scale));
};

/** The stored range a scaled value covers; three-point values cover their whole bucket. */
export const ratingRange = (value: number, scale: RatingScale) => {
	const stored = fromScale(value, scale);
	if (scale !== "three-point") {
		return { min: stored, max: stored };
	}
	const index = threePointIndex(stored);
	return { min: threePointFloors[index], max: threePointCeilings[index] };
};

export const scaledRangeBound = (stored: number, bound: "min" | "max", scale: RatingScale) => {
	if (scale !== "three-point" || bound === "min") {
		return toScale(stored, scale);
	}
	const index = threePointCeilings.findIndex((ceiling) => stored <= ceiling + 1e-9);
	return index === -1 ? 2 : index;
};
