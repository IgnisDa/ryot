import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { UpdatePluginInstallationBody } from "./schemas";

describe("UpdatePluginInstallationBody", () => {
	it("decodes config replacements, explicit unsets, and controls", () => {
		expect(
			Schema.decodeUnknownSync(UpdatePluginInstallationBody)({
				sortOrder: 3,
				isDisabled: true,
				unsetConfigKeys: ["region"],
				config: { token: "replacement" },
			}),
		).toEqual({
			sortOrder: 3,
			isDisabled: true,
			unsetConfigKeys: ["region"],
			config: { token: "replacement" },
		});
	});

	it("rejects invalid and excess fields", () => {
		for (const input of [
			{ config: [] },
			{ sortOrder: "3" },
			{ sortOrder: 1.5 },
			{ sortOrder: Number.NaN },
			{ sortOrder: Number.POSITIVE_INFINITY },
			{ sortOrder: -2_147_483_649 },
			{ sortOrder: 2_147_483_648 },
			{ isDisabled: null },
			{ unsetConfigKeys: [null] },
			{ unknown: true },
		]) {
			expect(() => Schema.decodeUnknownSync(UpdatePluginInstallationBody)(input)).toThrow();
		}
	});
});
