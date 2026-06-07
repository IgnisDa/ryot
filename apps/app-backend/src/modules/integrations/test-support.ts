import type { IntegrationRecord } from "./repository";

const now = "2026-06-17T00:00:00.000Z";

export const makeIntegration = (overrides: Partial<IntegrationRecord> = {}): IntegrationRecord => ({
	name: null,
	id: "int_1",
	lot: "sink",
	userId: "user_1",
	provider: "kodi",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	syncOwnership: false,
	lastFinishedAt: null,
	providerSpecifics: { kind: "kodi" },
	createdAt: now,
	updatedAt: now,
	webhookUrl: "http://localhost:3000/_i/int_1",
	extraSettings: { disableOnContinuousErrors: true },
	...overrides,
});

export const makeKomgaIntegration = (overrides: Partial<IntegrationRecord> = {}) =>
	makeIntegration({
		lot: "yank",
		provider: "komga",
		providerSpecifics: { kind: "komga", apiKey: "key", baseUrl: "http://komga" },
		...overrides,
	});

export const makeYoutubeMusicIntegration = (overrides: Partial<IntegrationRecord> = {}) =>
	makeIntegration({
		lot: "yank",
		provider: "youtube_music",
		providerSpecifics: {
			authCookie: "cookie",
			kind: "youtube_music",
			timezone: "America/New_York",
		},
		...overrides,
	});

export const makeRun = (status: "completed" | "failed") => ({
	status,
	progress: 0,
	id: "run_1",
	source: "kodi",
	failedItems: 0,
	createdAt: now,
	updatedAt: now,
	startedAt: null,
	finishedAt: null,
	totalItems: null,
	inputSummary: {},
	importedItems: 0,
	processedItems: 0,
	errorSummary: null,
});
