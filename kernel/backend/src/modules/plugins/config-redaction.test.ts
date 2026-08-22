import { expect, it } from "vitest";

import { redactPluginConfig } from "./config-redaction";

it("redacts nested secrets and secret defaults while preserving non-secret falsy values", () => {
	const secret = {
		label: "Secret",
		secret: true as const,
		type: "string" as const,
		description: "Secret setting",
		defaultValue: "default-secret",
	};
	const result = redactPluginConfig(
		{
			fields: {
				token: secret,
				nested: {
					type: "object",
					label: "Nested",
					description: "Nested settings",
					defaultValue: { enabled: false, password: "nested-default-secret" },
					properties: {
						password: secret,
						enabled: { type: "boolean", label: "Enabled", description: "Enabled flag" },
					},
				},
				accounts: {
					type: "array",
					label: "Accounts",
					description: "Account settings",
					items: {
						type: "object",
						label: "Account",
						description: "Account",
						properties: {
							password: secret,
							name: { label: "Name", type: "string", description: "Public name" },
						},
					},
				},
			},
		},
		{
			token: "top-secret",
			accounts: [{ name: "", password: "account-secret" }],
			nested: { enabled: false, password: "nested-secret" },
		},
	);
	expect(result.config).toEqual({ accounts: [{ name: "" }], nested: { enabled: false } });
	expect(result.configuredSecrets).toEqual(["accounts[].password", "nested.password", "token"]);
	expect(JSON.stringify(result)).not.toContain("-secret");
	expect(result.configSchema.fields["nested"]).toHaveProperty("defaultValue", { enabled: false });
});

it("does not report absent secrets as configured", () => {
	const result = redactPluginConfig(
		{ fields: { token: { secret: true, type: "string", label: "Token", description: "Token" } } },
		{ token: null },
	);
	expect(result.config).toEqual({});
	expect(result.configuredSecrets).toEqual([]);
});

it("keeps removed secret fields redacted while an incompatible package retains old configuration", () => {
	const result = redactPluginConfig(
		{ fields: {} },
		{ publicName: "Example", removedToken: "retained-secret" },
		{
			fields: {
				removedToken: { secret: true, type: "string", label: "Token", description: "Token" },
			},
		},
	);
	expect(result.config).toEqual({ publicName: "Example" });
	expect(result.configuredSecrets).toEqual(["removedToken"]);
});
