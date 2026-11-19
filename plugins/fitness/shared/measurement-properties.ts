export const measurementMetricProperties = (key: string, unit: string | undefined) => ({
	key,
	...(unit ? { unit } : {}),
});

export const measurementEntryProperties = (
	occurredAt: string,
	comment: null | string | undefined,
) => ({ occurredAt, ...(comment ? { comment } : {}) });

export const measurementEntryEntity = (occurredAt: string, comment: null | string | undefined) => ({
	name: "Measurement",
	entitySchemaSlug: "measurement-entry",
	properties: measurementEntryProperties(occurredAt, comment),
});

export const measurementReadingProperties = (value: number) => ({ value });
