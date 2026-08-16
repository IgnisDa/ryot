import { expect, it } from "@effect/vitest";

import { redactV2SchemaSecrets } from "./references";

it("redacts schema-marked configuration secrets and records pointers", () => {
	const result = redactV2SchemaSecrets(
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
