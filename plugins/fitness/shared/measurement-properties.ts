export const measurementMetricProperties = (key: string, unit: string | undefined) => ({
	key,
	...(unit ? { unit } : {}),
});

export const measurementReadingProperties = (
	value: number,
	comment: string | null | undefined,
) => ({ value, ...(comment ? { comment } : {}) });
