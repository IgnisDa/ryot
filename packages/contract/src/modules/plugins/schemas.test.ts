import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	PluginConflictError,
	PluginInvokeBody,
	PluginInvokeResult,
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
			{ ...uploadPayload, config: { invalid: undefined } },
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
			{ config: { invalid: undefined } },
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

it("accepts only JSON operation HTTP payloads and results", () => {
	const decodeBody = Schema.decodeUnknownSync(PluginInvokeBody);
	const decodeResult = Schema.decodeUnknownSync(PluginInvokeResult);

	expect(
		decodeBody({ payload: { values: [null, true, 1, "ok"] }, sourceHash: "source-hash" }),
	).toEqual({
		sourceHash: "source-hash",
		payload: { values: [null, true, 1, "ok"] },
	});
	expect(decodeBody({ payload: { values: [null, true, 1, "ok"] } })).toEqual({
		payload: { values: [null, true, 1, "ok"] },
	});
	expect(decodeResult({ result: ["ok"] })).toEqual({ result: ["ok"] });
	expect(() => decodeBody({ payload: { invalid: undefined } })).toThrow();
	expect(() => decodeResult({ result: Number.POSITIVE_INFINITY })).toThrow();
});
