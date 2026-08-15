import { Option, Result } from "effect";
import { expect, it } from "vitest";

import { automationHistoryRunRecipe, automationHistoryRunsRecipe } from "./automation-history";
import { backupRunRecipe } from "./backups";
import { godModeUsersRecipe, migrationReportRecipe } from "./god-mode";
import { importSourcesRecipe } from "./import-sources";
import { integrationProvidersRecipe } from "./integration-providers";
import { rowsResult } from "./test-utils";
import { userSettingsRecipe } from "./user-settings";

const date = "2026-09-23T10:00:00+02:00";
const page = (items: readonly unknown[], limit = 2, hasMore = false) =>
	rowsResult(items, { limit, hasMore, nextCursor: hasMore ? "next" : null });

it("normalizes persisted user preferences instead of rejecting old JSON", () => {
	const decoded = Result.getOrThrow(
		userSettingsRecipe().decode({
			data: {
				user: page([
					{
						name: "A",
						image: null,
						id: "user-1",
						email: "a@example.com",
						preferences: { language: "", allowNsfw: true, disableIntegrations: "yes" },
					},
				]),
			},
		}),
	);
	expect(decoded.preferences).toEqual({
		language: null,
		allowNsfw: true,
		disableIntegrations: false,
	});
});

it("maps missing backup detail to None", () => {
	expect(
		Option.isNone(
			Result.getOrThrow(backupRunRecipe({ id: "absent" }).decode({ data: { run: page([]) } })),
		),
	).toBe(true);
});

it("decodes executable import metadata and nullable export help", () => {
	const decoded = Result.getOrThrow(
		importSourcesRecipe({ limit: 2 }).decode({
			data: {
				sources: page([
					{
						id: "source",
						name: "Fixture",
						exportHelp: null,
						isStartable: false,
						description: "Import",
						pluginSlug: "fixture",
						slug: "fixture.import",
						workflowSlug: "import",
						requiredPluginConfigKeys: ["secret"],
						inputSchema: { fields: {}, unknownKeys: "strict" },
						missingPluginConfigKeys: ["RYOT_PLUGIN_FIXTURE_SECRET"],
					},
				]),
			},
		}),
	);
	expect(decoded.items[0]).toMatchObject({
		exportHelp: null,
		isStartable: false,
		workflowSlug: "import",
		missingPluginConfigKeys: ["RYOT_PLUGIN_FIXTURE_SECRET"],
	});
});

it("builds provider common fields by lot without deciding pro-key eligibility", () => {
	const decoded = Result.getOrThrow(
		integrationProvidersRecipe({ limit: 2 }).decode({
			data: {
				providers: page([
					{
						id: "a",
						lot: "push",
						slug: "push",
						name: "Push",
						hasScript: true,
						pluginSlug: "plug",
						requiresProKey: false,
						description: "Push provider",
						settingsSchema: { fields: {} },
					},
					{
						id: "b",
						lot: "yank",
						slug: "yank",
						name: "Yank",
						hasScript: false,
						pluginSlug: "plug",
						requiresProKey: true,
						description: "Yank provider",
						settingsSchema: { fields: {} },
					},
				]),
			},
		}),
	);
	expect(Object.keys(decoded.items[0]?.commonSchema.fields ?? {})).not.toContain("minimumProgress");
	expect(Object.keys(decoded.items[1]?.commonSchema.fields ?? {})).toContain("syncOwnership");
	expect(decoded.items[1]).toMatchObject({ hasScript: false, requiresProKey: true });
});

it("keeps admin user count independent of the cursor page and normalizes dates", () => {
	const decoded = Result.getOrThrow(
		godModeUsersRecipe({ limit: 2, search: "a" }).decode({
			data: {
				total: { type: "aggregate", items: [{ count: 17 }] },
				users: page(
					[
						{
							id: "u",
							name: "A",
							createdAt: date,
							disabledAt: null,
							authState: "mixed",
							email: "a@example.com",
							twoFactorEnabled: false,
						},
					],
					2,
					true,
				),
			},
		}),
	);
	expect(decoded.total).toBe(17);
	expect(decoded.items[0]?.createdAt).toBe("2026-09-23T08:00:00.000Z");
	expect(decoded.pageInfo.nextCursor).toBe("next");
});

it("decodes migration details and preserves include truncation metadata", () => {
	const decoded = Result.getOrThrow(
		migrationReportRecipe({ limit: 5 }).decode({
			data: {
				entries: page([
					{
						seq: 3,
						count: 101,
						phase: "media",
						createdAt: date,
						level: "warning",
						totalDetails: 101,
						message: "Skipping",
						elapsedSeconds: null,
						code: "integration-cache-provider-unmapped",
						details: {
							pageInfo: { limit: 100, hasMore: true },
							items: [
								{
									seq: 1,
									detail: {
										userId: "u",
										legacyCacheId: "c",
										legacyProvider: null,
										providersConsumedOn: [],
										code: "integration-cache-provider-unmapped",
									},
								},
							],
						},
					},
				]),
			},
		}),
	);
	expect(decoded.items[0]?.details.pageInfo.hasMore).toBe(true);
	expect(decoded.items[0]?.details.items[0]?.detail).toMatchObject({ legacyCacheId: "c" });
});

const run = {
	id: "run",
	queuedAt: date,
	stage: "after",
	pluginId: null,
	startedAt: null,
	attemptCount: 1,
	finishedAt: null,
	status: "failed",
	hookSlug: "hook",
	hookName: "Hook",
	pluginName: null,
	skipReason: null,
	delivery: "async",
	nextAttemptAt: null,
	triggerId: "trigger",
	executionUserId: null,
	pluginRevisionId: null,
	artifactsExpireAt: date,
	triggerKind: { operation: "emit", category: "signal", resource: "signal" },
};

it("applies all automation filters and maps projected payload and attempt artifacts", () => {
	const list = automationHistoryRunsRecipe({
		limit: 5,
		to: date,
		from: date,
		pluginId: "p",
		hookSlug: "h",
		stage: "after",
		triggerId: "t",
		status: "failed",
	});
	expect(list.document.queries.runs?.where).toMatchObject({
		type: "and",
		predicates: [{}, {}, {}, {}, {}, {}, {}],
	});
	const decoded = Result.getOrThrow(
		automationHistoryRunRecipe({ id: "run" }).decode({
			data: {
				run: page([
					{
						...run,
						historyPayloadTruncated: true,
						historyPayload: { payload: "redacted" },
						retryEligibility: { reason: "expired" },
						triggers: {
							pageInfo: { limit: 1, hasMore: false },
							items: [
								{ id: "trigger", occurredAt: date, kind: run.triggerKind, payloadPrunedAt: null },
							],
						},
						attempts: {
							pageInfo: { limit: 50, hasMore: true },
							items: [
								{
									logs: null,
									runId: "run",
									timing: null,
									id: "attempt",
									startedAt: date,
									attemptNumber: 1,
									status: "failed",
									finishedAt: date,
									retryable: false,
									artifactsPrunedAt: null,
									artifactsTruncated: true,
									failureKind: "business-failure",
									error: { code: "failed", message: "redacted" },
								},
							],
						},
					},
				]),
			},
		}),
	);
	expect(Option.isSome(decoded)).toBe(true);
	if (Option.isSome(decoded)) {
		expect(decoded.value.trigger).toMatchObject({
			payloadTruncated: true,
			payload: { payload: "redacted" },
		});
		expect(decoded.value.attemptsTruncated).toBe(true);
		expect(decoded.value.attempts[0]).toMatchObject({
			artifactsTruncated: true,
			error: { code: "failed" },
		});
		expect(decoded.value.run).not.toHaveProperty("triggers");
	}
	expect(
		Option.isNone(
			Result.getOrThrow(
				automationHistoryRunRecipe({ id: "absent" }).decode({ data: { run: page([]) } }),
			),
		),
	).toBe(true);
});
