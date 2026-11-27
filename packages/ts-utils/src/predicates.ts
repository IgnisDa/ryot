export const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isUnknownArray = (value: unknown): value is ReadonlyArray<unknown> =>
	Array.isArray(value);
