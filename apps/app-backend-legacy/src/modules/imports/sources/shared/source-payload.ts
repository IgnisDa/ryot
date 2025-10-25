export const getRequiredSourcePayloadString = (
	sourcePayload: Record<string, unknown> | undefined,
	field: string,
): string => {
	const value = sourcePayload?.[field];
	return typeof value === "string" ? value.trim() : "";
};

export const getOptionalSourcePayloadBoolean = (
	sourcePayload: Record<string, unknown> | undefined,
	field: string,
): boolean | undefined => {
	const value = sourcePayload?.[field];
	return typeof value === "boolean" ? value : undefined;
};

export const getOptionalSourcePayloadString = (
	sourcePayload: Record<string, unknown> | undefined,
	field: string,
): string | undefined => {
	const value = sourcePayload?.[field];
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};
