import { Option, Result } from "effect";
import { expect, it } from "vitest";

import { backupRunRecipe } from "./backups";
import { godModeUsersRecipe, migrationReportRecipe } from "./god-mode";
import { importSourcesRecipe } from "./import-sources";
import { integrationProvidersRecipe } from "./integration-providers";
import { rowsResult } from "./test-utils";

const date = "2026-09-23T10:00:00+02:00";
const readinessFields = {
	pluginScope: "system",
	installationId: "installation",
	readinessMetadata: {
		oauthProviders: [],
		availableConfigKeys: [],
		workflows: [{ slug: "import", scriptSlug: "root" }],
		scripts: [
			{
				slug: "root",
				oauthConnectionFields: [],
				executableDependencies: [],
				requiredPluginConfigKeys: [],
				optionalPluginConfigKeys: [],
			},
		],
	},
};
const providerReadinessFields = {
	plan: null,
	...readinessFields,
	scriptSlug: "root",
	readinessConnections: [],
};
const page = (items: readonly unknown[], limit = 2, hasMore = false) =>
	rowsResult(items, { limit, hasMore, nextCursor: hasMore ? "next" : null });

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
						...readinessFields,
						plan: null,
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

it("builds provider common fields from lot and ownership-sync support", () => {
	const decoded = Result.getOrThrow(
		integrationProvidersRecipe({ limit: 3 }).decode({
			data: {
				providers: page(
					[
						{
							...providerReadinessFields,
							id: "a",
							lot: "push",
							slug: "push",
							name: "Push",
							hasScript: true,
							pluginSlug: "plug",
							requiresProKey: false,
							supportsOwnershipSync: false,
							description: "Push provider",
							settingsSchema: { fields: {} },
						},
						{
							...providerReadinessFields,
							id: "b",
							lot: "yank",
							slug: "yank",
							name: "Yank",
							hasScript: false,
							pluginSlug: "plug",
							requiresProKey: true,
							supportsOwnershipSync: true,
							description: "Yank provider",
							settingsSchema: { fields: {} },
						},
						{
							...providerReadinessFields,
							id: "c",
							lot: "yank",
							hasScript: true,
							pluginSlug: "plug",
							requiresProKey: false,
							slug: "unsupported-yank",
							name: "Unsupported yank",
							supportsOwnershipSync: false,
							settingsSchema: { fields: {} },
							description: "Yank provider without ownership sync",
						},
					],
					3,
				),
			},
		}),
	);
	expect(Object.keys(decoded.items[0]?.commonSchema.fields ?? {})).not.toContain("minimumProgress");
	expect(Object.keys(decoded.items[0]?.commonSchema.fields ?? {})).not.toContain("syncOwnership");
	expect(Object.keys(decoded.items[1]?.commonSchema.fields ?? {})).toContain("syncOwnership");
	expect(Object.keys(decoded.items[2]?.commonSchema.fields ?? {})).not.toContain("syncOwnership");
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
