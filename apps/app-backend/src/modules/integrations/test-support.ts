import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";

import type { IntegrationRecord } from "./repository";

const now = "2026-06-17T00:00:00.000Z";

export const makeIntegration = (overrides: Partial<IntegrationRecord> = {}): IntegrationRecord => ({
	name: null,
	lot: "sink",
	id: IntegrationId.make("int_1"),
	userId: UserId.make("user_1"),
	provider: "test-provider",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	syncOwnership: false,
	lastFinishedAt: null,
	providerSpecifics: {},
	createdAt: now,
	updatedAt: now,
	webhookUrl: "http://localhost:3000/_i/int_1",
	extraSettings: { disableOnContinuousErrors: true },
	...overrides,
});

export const makeRun = (status: "completed" | "failed") => ({
	status,
	progress: 0,
	id: ImportRunId.make("run_1"),
	source: "test-provider",
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
