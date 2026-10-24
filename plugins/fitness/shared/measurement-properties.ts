export const measurementMetricProperties = (key: string, unit: string | undefined) => ({
	key,
	...(unit ? { unit } : {}),
});

export const measurementEntryProperties = (
	occurredAt: string,
	comment: string | null | undefined,
) => ({ occurredAt, ...(comment ? { comment } : {}) });

export const measurementReadingProperties = (value: number) => ({ value });
