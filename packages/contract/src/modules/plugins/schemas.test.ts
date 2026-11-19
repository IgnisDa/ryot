import { describe, expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import { PluginId } from "../../schema/brands";
import {
	PluginConflictError,
	PluginInvokeBody,
	PluginInvokeResult,
	UpdatePluginInstallationBody,
	UpdatePrivatePluginBody,
} from "./schemas";

const uploadPayload = { contentHash: "source-hash", uploadToken: "fixture-upload-token" };
const pluginId = PluginId.make("fixture-plugin-id");

describe("UpdatePrivatePluginBody", () => {
	it.effect(
		"decodes an upload token and config replacement",
		() =>
			Effect.gen(function* () {
				expect(
					yield* Schema.decodeEffect(UpdatePrivatePluginBody)({
						...uploadPayload,
						config: { token: "replacement" },
					}),
				).toEqual({ ...uploadPayload, config: { token: "replacement" } });
			}),
		testTimeout,
	);

	it.effect(
		"rejects incomplete uploads and excess fields",
		() =>
			Effect.gen(function* () {
				for (const input of [
					{ ...uploadPayload, uploadToken: undefined },
					{ uploadToken: "fixture-upload-token" },
					{ ...uploadPayload, config: { invalid: undefined } },
					{ ...uploadPayload, unknown: true },
				]) {
					yield* Effect.flip(Schema.decodeUnknownEffect(UpdatePrivatePluginBody)(input));
				}
			}),
		testTimeout,
	);
});

describe("UpdatePluginInstallationBody", () => {
	it.effect(
		"decodes config replacements and controls",
		() =>
			Effect.gen(function* () {
				expect(
					yield* Schema.decodeEffect(UpdatePluginInstallationBody)({
						sortOrder: 3,
						isHidden: true,
						config: { token: "replacement" },
					}),
				).toEqual({ sortOrder: 3, isHidden: true, config: { token: "replacement" } });
			}),
		testTimeout,
	);

	it.effect(
		"rejects invalid and excess fields",
		() =>
			Effect.gen(function* () {
				for (const input of [
					{ config: [] },
					{ config: { invalid: undefined } },
					{ sortOrder: "3" },
					{ sortOrder: 1.5 },
					{ sortOrder: Number.NaN },
					{ sortOrder: Number.POSITIVE_INFINITY },
					{ sortOrder: -2_147_483_649 },
					{ sortOrder: 2_147_483_648 },
					{ isHidden: null },
					{ unknown: true },
				]) {
					yield* Effect.flip(Schema.decodeUnknownEffect(UpdatePluginInstallationBody)(input));
				}
			}),
		testTimeout,
	);
});

it.effect(
	"decodes saved-view uninstall conflicts",
	() =>
		Effect.gen(function* () {
			expect(
				yield* Schema.decodeEffect(PluginConflictError)({
					_tag: "PluginConflictError",
					reason: { pluginId, code: "saved-view-referenced" },
				}),
			).toMatchObject({ reason: { pluginId, code: "saved-view-referenced" } });
		}),
	testTimeout,
);

it.effect(
	"decodes stale plugin source revision conflicts",
	() =>
		Effect.gen(function* () {
			expect(
				yield* Schema.decodeEffect(PluginConflictError)({
					_tag: "PluginConflictError",
					reason: { pluginId, code: "source-revision-stale" },
				}),
			).toMatchObject({ reason: { pluginId, code: "source-revision-stale" } });
		}),
	testTimeout,
);

it.effect(
	"accepts only JSON operation HTTP payloads and results",
	() =>
		Effect.gen(function* () {
			const decodeBody = Schema.decodeUnknownEffect(PluginInvokeBody);
			const decodeResult = Schema.decodeUnknownEffect(PluginInvokeResult);

			expect(
				yield* decodeBody({
					contentHash: "source-hash",
					payload: { values: [null, true, 1, "ok"] },
				}),
			).toEqual({ contentHash: "source-hash", payload: { values: [null, true, 1, "ok"] } });
			expect(yield* decodeBody({ payload: { values: [null, true, 1, "ok"] } })).toEqual({
				payload: { values: [null, true, 1, "ok"] },
			});
			expect(yield* decodeResult({ result: ["ok"] })).toEqual({ result: ["ok"] });
			yield* Effect.flip(decodeBody({ payload: { invalid: undefined } }));
			yield* Effect.flip(decodeResult({ result: Number.POSITIVE_INFINITY }));
		}),
	testTimeout,
);
