import { describe, expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import {
	type MediaUserDataAction,
	MediaUserDataInput,
} from "../../shared/media-user-data-operations";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-user-data.sandbox";

const submittedAt = "2026-10-27T09:00:00.000Z";
const submissionId = "submission-1";

const run = (input: MediaUserDataAction) =>
	runSandboxTestScript(
		definition,
		{ ...input, submittedAt, submissionId },
		defineSandboxTestHost(manifest, {}),
		execution,
	);

describe("media user data operation", () => {
	it.live(
		"clears one media graph",
		() =>
			Effect.gen(function* () {
				expect(
					yield* run({ action: "remove", entityId: "media-1", entitySchemaSlug: "movie" }),
				).toEqual<unknown>({
					output: {},
					changes: { entities: { clears: [{ entityId: "media-1", entitySchemaSlug: "movie" }] } },
				});
			}),
		testTimeout,
	);

	it.live(
		"merges one media graph",
		() =>
			Effect.gen(function* () {
				expect(
					yield* run({
						action: "merge",
						mergeFrom: "source-1",
						mergeInto: "target-1",
						entitySchemaSlug: "show",
					}),
				).toEqual<unknown>({
					output: {},
					changes: {
						entities: {
							merges: [{ mergeFrom: "source-1", mergeInto: "target-1", entitySchemaSlug: "show" }],
						},
					},
				});
			}),
		testTimeout,
	);

	it.live(
		"uses the shared library-member schema allow-list for both actions",
		() =>
			Effect.gen(function* () {
				for (const entitySchemaSlug of mediaLibraryMemberEntitySchemaSlugs) {
					expect(
						yield* run({ action: "remove", entitySchemaSlug, entityId: "media-1" }),
					).toMatchObject({ changes: { entities: { clears: [{ entitySchemaSlug }] } } });
					expect(
						yield* run({
							action: "merge",
							entitySchemaSlug,
							mergeFrom: "source-1",
							mergeInto: "target-1",
						}),
					).toMatchObject({ changes: { entities: { merges: [{ entitySchemaSlug }] } } });
				}
				expect(
					Schema.decodeUnknownResult(MediaUserDataInput)({
						submittedAt,
						submissionId,
						action: "remove",
						entityId: "media-1",
						entitySchemaSlug: "collection",
					})._tag,
				).toBe("Failure");
			}),
		testTimeout,
	);
});
