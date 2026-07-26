import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	PluginConflictError,
	UpdatePluginInstallationBody,
	UpdatePrivatePluginBody,
} from "./schemas";

const uploadPayload = {
	uploadToken: "fixture-upload-token",
};

describe("UpdatePrivatePluginBody", () => {
	it("decodes an upload token and config patch", () => {
		expect(
			Schema.decodeUnknownSync(UpdatePrivatePluginBody)({
				...uploadPayload,
				unsetConfigKeys: ["region"],
				config: { token: "replacement" },
			}),
		).toEqual({ ...uploadPayload, unsetConfigKeys: ["region"], config: { token: "replacement" } });
	});

	it("rejects incomplete uploads and excess fields", () => {
		for (const input of [
			{ ...uploadPayload, uploadToken: undefined },
			{ ...uploadPayload, unknown: true },
		]) {
			expect(() => Schema.decodeUnknownSync(UpdatePrivatePluginBody)(input)).toThrow();
		}
	});
});

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

it("decodes saved-view uninstall conflicts", () => {
	expect(
		Schema.decodeUnknownSync(PluginConflictError)({
			_tag: "PluginConflictError",
			reason: { code: "saved-view-referenced", pluginSlug: "fixture" },
		}),
	).toMatchObject({ reason: { code: "saved-view-referenced", pluginSlug: "fixture" } });
});
