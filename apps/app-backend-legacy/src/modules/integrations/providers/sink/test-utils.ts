import type { SinkParserInput } from "./shared";

export const makeSinkIntegration = (
	overrides: Partial<SinkParserInput["integration"]> = {},
): SinkParserInput["integration"] => ({
	name: null,
	id: "int_1",
	lot: "sink",
	userId: "user_1",
	provider: "kodi",
	isDisabled: false,
	syncOwnership: false,
	lastFinishedAt: null,
	minimumProgress: "2",
	maximumProgress: "95",
	providerSpecifics: { kind: "kodi" },
	extraSettings: { disableOnContinuousErrors: false },
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	...overrides,
});
