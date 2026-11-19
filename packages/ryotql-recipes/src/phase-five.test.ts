import { expect, it } from "bun:test";

import { Option, Result } from "effect";

import { backupRunRecipe } from "./backups";
import { importSourcesRecipe } from "./import-sources";
import { instanceAdminUsersRecipe, migrationReportRecipe } from "./instance-admin";
import { integrationProvidersRecipe } from "./integration-providers";
import { bindRecipe, rowsResult } from "./test-utils";

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
				capabilities: [],
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
			Result.getOrThrow(
				bindRecipe(backupRunRecipe, { id: "absent" }).decode({ data: { run: page([]) } }),
			),
		),
	).toBe(true);
});

it("decodes executable import metadata and nullable export help", () => {
	const decoded = Result.getOrThrow(
		bindRecipe(importSourcesRecipe, { limit: 2 }).decode({
			data: {
				sources: page([
					{
						...readinessFields,
						plan: null,
						id: "source",
						exportHelp: null,
						isStartable: false,
						slug: "fixture.import",
						workflowSlug: "import",
						packageId: "ryot/fixture",
						pluginId: "fixture-owner",
						requiredPluginConfigKeys: ["secret"],
						inputSchema: { fields: {}, unknownKeys: "strict" },
						name: { key: "test.fixture", namespace: "plugin-1" },
						missingPluginConfigKeys: ["RYOT_PLUGIN_FIXTURE_SECRET"],
						description: { key: "test.import", namespace: "plugin-1" },
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
		bindRecipe(integrationProvidersRecipe, { limit: 3 }).decode({
			data: {
				providers: page(
					[
						{
							...providerReadinessFields,
							id: "a",
							lot: "push",
							slug: "push",
							hasScript: true,
							entitlement: null,
							pluginId: "plugin-owner",
							packageId: "ryot/fixture",
							supportsOwnershipSync: false,
							settingsSchema: { fields: {} },
							name: { key: "test.push", namespace: "plugin-1" },
							description: { namespace: "plugin-1", key: "test.push-provider" },
						},
						{
							...providerReadinessFields,
							id: "b",
							lot: "yank",
							slug: "yank",
							hasScript: false,
							entitlement: "pro",
							pluginId: "plugin-owner",
							packageId: "ryot/fixture",
							supportsOwnershipSync: true,
							settingsSchema: { fields: {} },
							name: { key: "test.yank", namespace: "plugin-1" },
							description: { namespace: "plugin-1", key: "test.yank-provider" },
						},
						{
							...providerReadinessFields,
							id: "c",
							lot: "yank",
							hasScript: true,
							entitlement: null,
							pluginId: "plugin-owner",
							slug: "unsupported-yank",
							packageId: "ryot/fixture",
							supportsOwnershipSync: false,
							settingsSchema: { fields: {} },
							name: { namespace: "plugin-1", key: "test.unsupported-yank" },
							description: {
								namespace: "plugin-1",
								key: "test.yank-provider-without-ownership-sync",
							},
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
	expect(decoded.items[1]).toMatchObject({ hasScript: false, entitlement: "pro" });
});

it("keeps admin user count independent of the cursor page and normalizes dates", () => {
	const decoded = Result.getOrThrow(
		bindRecipe(instanceAdminUsersRecipe, { limit: 2, search: "a" }).decode({
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
		bindRecipe(migrationReportRecipe, { limit: 5 }).decode({
			data: {
				entries: page([
					{
						seq: 3,
						count: 101,
						createdAt: date,
						phase: "fixture",
						level: "warning",
						totalDetails: 101,
						message: "Skipping",
						elapsedSeconds: null,
						code: "record-skipped",
						details: {
							pageInfo: { limit: 100, hasMore: true },
							items: [
								{
									seq: 1,
									detail: { key: "c", provenance: [], label: "Record c", sentence: "Skipped." },
								},
							],
						},
					},
				]),
			},
		}),
	);
	expect(decoded.items[0]?.details.pageInfo.hasMore).toBe(true);
	expect(decoded.items[0]?.details.items[0]?.detail).toMatchObject({ key: "c" });
});
