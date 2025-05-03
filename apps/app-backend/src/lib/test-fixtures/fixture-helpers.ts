export const cloneFixture = <T>(value: T): T => structuredClone(value);

export const withOverrides = <T extends object>(
	defaults: T,
	overrides: Partial<T> = {},
): T => ({
	...cloneFixture(defaults),
	...overrides,
});

export const createCreatedAt = () => new Date("2024-01-01T00:00:00.000Z");

export const createUpdatedAt = () => new Date("2024-01-01T00:00:00.000Z");

export const createOccurredAt = () => new Date("2026-03-08T10:15:00.000Z");
