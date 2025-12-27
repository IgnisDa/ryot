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

export const normalizeBuiltinMediaEventProperties = (input: {
	isBuiltin: boolean;
	eventSchemaSlug: string;
	entitySchemaSlug: string;
	properties: Record<string, unknown>;
}) => {
	if (
		!input.isBuiltin ||
		input.eventSchemaSlug !== "progress" ||
		!builtinMediaEntitySchemaSlugSet.has(input.entitySchemaSlug)
	) {
		return input.properties;
	}

	return {
		...input.properties,
		progressPercent: normalizeProgressPercent(
			input.properties.progressPercent as number,
		),
	};
};
