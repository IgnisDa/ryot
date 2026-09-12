import { describe, expect, it } from "vitest";

import { evaluateIngestionReadiness, type IngestionReadinessMetadata } from "./ingestion-readiness";

const script = (slug: string, keys: ReadonlyArray<string> = []) => ({
	slug,
	oauthConnectionFields: [],
	executableDependencies: [],
	requiredPluginConfigKeys: keys,
	optionalPluginConfigKeys: ["optionalToken"],
});

const metadata: IngestionReadinessMetadata = {
	oauthProviders: [],
	availableConfigKeys: [],
	workflows: [{ slug: "import", scriptSlug: "root" }],
	scripts: [
		{
			...script("root"),
			executableDependencies: [
				{
					slug: "api",
					kind: "script",
					selection: { key: "api", id: "collector", stage: "settings" },
				},
				{
					kind: "script",
					slug: "export",
					selection: { key: "export", id: "collector", stage: "settings" },
				},
				{
					kind: "script",
					slug: "provider",
					selection: { key: "remote", id: "provider", stage: "record" },
				},
			],
		},
		script("api", ["clientId", "shared"]),
		script("export", ["shared"]),
		script("provider", ["providerToken"]),
	],
};

const input = {
	metadata,
	operation: "import",
	kind: "workflow" as const,
	settingsSchema: { fields: {} },
	sourcePlan: {
		selections: { collector: { field: "mode", cases: { user: "api", export: "export" } } },
	},
};

describe("ingestion readiness", () => {
	it("shows only unconditional picker requirements and excludes optional and record reads", () => {
		expect(evaluateIngestionReadiness(input)).toEqual({
			plan: null,
			ready: false,
			blockReasons: [{ key: "shared", code: "configuration-required" }],
		});
	});

	it("selects the export pipeline without requiring API configuration", () => {
		expect(
			evaluateIngestionReadiness({
				...input,
				settings: { mode: "export" },
				metadata: { ...metadata, availableConfigKeys: ["shared"] },
			}),
		).toEqual({
			ready: true,
			blockReasons: [],
			plan: { operation: "import", selection: { collector: "export" } },
		});
		expect(
			evaluateIngestionReadiness({ ...input, settings: { mode: "user" } }).blockReasons,
		).toEqual([
			{ key: "clientId", code: "configuration-required" },
			{ key: "shared", code: "configuration-required" },
		]);
	});

	it("checks fixed selections in the picker and rejects unsupported settings and accepted plans", () => {
		expect(
			evaluateIngestionReadiness({
				...input,
				sourcePlan: { selections: { collector: { value: "api" } } },
			}).blockReasons,
		).toEqual([
			{ key: "clientId", code: "configuration-required" },
			{ key: "shared", code: "configuration-required" },
		]);
		expect(() => evaluateIngestionReadiness({ ...input, settings: { mode: "unknown" } })).toThrow(
			"has no case",
		);
		expect(() =>
			evaluateIngestionReadiness({
				...input,
				sourcePlan: { selections: { collector: { value: "unknown" } } },
			}),
		).toThrow("unsupported selection");
		expect(() =>
			evaluateIngestionReadiness({
				...input,
				settings: { mode: "export" },
				acceptedPlan: { operation: "import", selection: { collector: "api" } },
			}),
		).toThrow("does not match");
		expect(() =>
			evaluateIngestionReadiness({
				...input,
				settings: { mode: "export" },
				acceptedPlan: { operation: "other", selection: { collector: "export" } },
			}),
		).toThrow("does not match");
	});

	it("follows shared helpers and terminates cycles", () => {
		expect(
			evaluateIngestionReadiness({
				...input,
				metadata: {
					...metadata,
					scripts: [
						{ ...script("root"), executableDependencies: [{ kind: "script", slug: "helper" }] },
						{
							...script("helper", ["token"]),
							executableDependencies: [{ slug: "import", kind: "workflow" }],
						},
					],
				},
			}).blockReasons,
		).toEqual([{ key: "token", code: "configuration-required" }]);
	});

	it("rejects missing executable metadata instead of claiming readiness", () => {
		expect(() =>
			evaluateIngestionReadiness({ ...input, metadata: { ...metadata, scripts: [] } }),
		).toThrow("unavailable");
		expect(() =>
			evaluateIngestionReadiness({ ...input, settings: {}, sourcePlan: undefined }),
		).toThrow("missing selection");
	});

	it("derives all OAuth client and connection reasons from generated reads and selected settings", () => {
		const oauthInput = {
			...input,
			operation: "oauth",
			sourcePlan: undefined,
			kind: "script" as const,
			metadata: {
				...metadata,
				scripts: [{ ...script("oauth"), oauthConnectionFields: ["account"] }],
				oauthProviders: [
					{ slug: "remote", clientIdConfigKey: "id", clientSecretConfigKey: "secret" },
				],
			},
			settingsSchema: {
				fields: {
					account: {
						label: "Account",
						description: "Account",
						type: "string" as const,
						validation: { required: true },
						format: { provider: "remote", kind: "oauth-connection" as const },
					},
				},
			},
		} satisfies Parameters<typeof evaluateIngestionReadiness>[0];
		expect(evaluateIngestionReadiness(oauthInput).blockReasons).toEqual([
			{ key: "id", code: "oauth-client-required" },
			{ key: "secret", code: "oauth-client-required" },
		]);
		expect(evaluateIngestionReadiness({ ...oauthInput, settings: {} }).blockReasons).toEqual([
			{ key: "account", code: "connection-required" },
			{ key: "id", code: "oauth-client-required" },
			{ key: "secret", code: "oauth-client-required" },
		]);
		expect(
			evaluateIngestionReadiness({
				...oauthInput,
				connectedFields: ["account"],
				settings: { account: "connection" },
				metadata: { ...oauthInput.metadata, availableConfigKeys: ["id", "secret"] },
			}).ready,
		).toBe(true);
		expect(
			evaluateIngestionReadiness({
				...oauthInput,
				settings: {},
				settingsSchema: {
					fields: { account: { ...oauthInput.settingsSchema.fields.account, validation: {} } },
				},
			}).ready,
		).toBe(true);
	});
});
