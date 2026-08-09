import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { PluginManifest } from "./manifest";
import {
	PluginConflictError,
	UpdatePluginInstallationBody,
	UpdatePrivatePluginBody,
} from "./schemas";

const packagePayload = {
	files: {},
	manifest: Schema.decodeUnknownSync(PluginManifest)({
		boot: [],
		crons: [],
		scripts: [],
		providers: [],
		workflows: [],
		operations: [],
		savedViews: [],
		importSources: [],
		userBootstrap: [],
		signalSchemas: [],
		entitySchemas: [],
		httpRateLimits: [],
		relationshipSchemas: [],
		integrationProviders: [],
		configSchema: { fields: {}, unknownKeys: "strict" },
		metadata: {
			icon: "fixture",
			name: "Fixture",
			slug: "fixture",
			version: "2.0.0",
			description: "Fixture",
		},
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
		},
	}),
};

describe("UpdatePrivatePluginBody", () => {
	it("decodes a complete package and config patch", () => {
		expect(
			Schema.decodeUnknownSync(UpdatePrivatePluginBody)({
				...packagePayload,
				unsetConfigKeys: ["region"],
				config: { token: "replacement" },
			}),
		).toEqual({ ...packagePayload, unsetConfigKeys: ["region"], config: { token: "replacement" } });
	});

	it("rejects incomplete packages and excess fields", () => {
		for (const input of [
			{ ...packagePayload, files: undefined },
			{ ...packagePayload, manifest: undefined },
			{ ...packagePayload, unknown: true },
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
