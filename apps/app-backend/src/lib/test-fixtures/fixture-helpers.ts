import { dayjs } from "@ryot/ts-utils";

export const cloneFixture = <T>(value: T): T => structuredClone(value);

export const withOverrides = <T extends object>(
	defaults: T,
	overrides: Partial<T> = {},
): T => ({
	...cloneFixture(defaults),
	...overrides,
});

export const createCreatedAt = () => dayjs("2024-01-01T00:00:00.000Z").toDate();

export const createUpdatedAt = () => dayjs("2024-01-01T00:00:00.000Z").toDate();

export const createOccurredAt = () =>
	dayjs("2026-03-08T10:15:00.000Z").toDate();
