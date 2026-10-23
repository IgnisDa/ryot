import { describe, expect, it } from "vitest";

import type { AppSchema } from "./property-schema";
import { retainPropertySecrets } from "./property-secrets";

const schema: AppSchema = {
	fields: {
		settings: {
			type: "object",
			label: "Settings",
			description: "Settings",
			properties: {
				name: { label: "Name", type: "string", description: "Name" },
				token: { secret: true, type: "string", label: "Token", description: "Token" },
			},
		},
		accounts: {
			type: "array",
			label: "Accounts",
			description: "Accounts",
			items: {
				type: "object",
				label: "Account",
				description: "Account",
				properties: {
					token: { secret: true, type: "string", label: "Token", description: "Token" },
				},
			},
		},
	},
};

describe("retaining schema secrets", () => {
	it("keeps omitted object secrets without retaining removed public siblings", () => {
		expect(
			retainPropertySecrets(
				schema,
				{ settings: { name: "Old", token: "private" } },
				{ settings: {} },
			),
		).toEqual({ settings: { token: "private" } });
	});

	it("replaces arrays atomically and never transfers secrets by index", () => {
		const stored = { accounts: [{ token: "first" }, { token: "second" }] };
		expect(retainPropertySecrets(schema, stored, {})).toEqual(stored);
		expect(retainPropertySecrets(schema, stored, { accounts: [{ token: "new" }] })).toEqual({
			accounts: [{ token: "new" }],
		});
		expect(retainPropertySecrets(schema, stored, { accounts: [] })).toEqual({ accounts: [] });
	});

	it("honors explicit clears instead of restoring secrets", () => {
		expect(
			retainPropertySecrets(schema, { settings: { token: "private" } }, { settings: null }),
		).toEqual({ settings: null });
	});
});
