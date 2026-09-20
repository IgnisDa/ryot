import { expect, it } from "@effect/vitest";

import { redactSchemaSecrets } from "./references";

it("redacts schema-marked configuration secrets and records pointers", () => {
	const result = redactSchemaSecrets(
		{ token: "secret", unit: "minutes" },
		{
			unknownKeys: "strict",
			fields: {
				unit: { label: "Unit", type: "string", validation: {}, description: "Unit" },
				token: {
					secret: true,
					label: "Token",
					type: "string",
					validation: {},
					description: "Token",
				},
			},
		},
		"/installations/one/config",
	);
	expect(result).toEqual({
		redacted: { unit: "minutes" },
		redactions: ["/installations/one/config/token"],
	});
});

it("drops OAuth connection settings from exported integration settings", () => {
	const result = redactSchemaSecrets(
		{ unit: "minutes", account: "connection-id" },
		{
			fields: {
				unit: { label: "Unit", type: "string", description: "Unit" },
				account: {
					type: "string",
					label: "Account",
					description: "Linked account",
					format: { provider: "account", kind: "oauth-connection" },
				},
			},
		},
		"/integrations/one/providerSpecifics",
	);
	expect(result).toEqual({
		redacted: { unit: "minutes" },
		redactions: ["/integrations/one/providerSpecifics/account"],
	});
});
