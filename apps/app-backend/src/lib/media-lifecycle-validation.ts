import { builtinMediaEntitySchemaSlugSet } from "~/lib/media/constants";

export const roundHalfUpToTwoDecimals = (value: number) =>
	Math.round((value + Number.EPSILON) * 100) / 100;

export const normalizeProgressPercent = (value: number) => {
	const progressPercent = roundHalfUpToTwoDecimals(value);

	if (progressPercent <= 0 || progressPercent >= 100) {
		throw new Error(
			"Progress percent must be greater than 0 and less than 100",
		);
	}

	return progressPercent;
};

export const normalizeRating = (value: number) => {
	if (!Number.isInteger(value) || value < 1 || value > 5) {
		throw new Error("Rating must be an integer between 1 and 5");
	}

	return value;
};

export const normalizeBuiltinMediaEventProperties = (input: {
	isBuiltin: boolean;
	eventSchemaSlug: string;
	entitySchemaSlug: string;
	properties: Record<string, unknown>;
}) => {
	if (
		!input.isBuiltin ||
		!builtinMediaEntitySchemaSlugSet.has(input.entitySchemaSlug)
	) {
		return input.properties;
	}

	if (input.eventSchemaSlug === "progress") {
		return {
			...input.properties,
			progressPercent: normalizeProgressPercent(
				input.properties.progressPercent as number,
			),
		};
	}

	if (input.eventSchemaSlug === "review") {
		return {
			...input.properties,
			rating: normalizeRating(input.properties.rating as number),
		};
	}

	return input.properties;
};
