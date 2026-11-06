import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-user-data.sandbox";

const submittedAt = "2026-10-27T09:00:00.000Z";
const submissionId = "submission-1";

const recordingHost = (input?: {
	readonly mergeUserEntityData?: () => Effect.Effect<
		{ readonly movedEventsCount: number; readonly movedRelationshipsCount: number },
		SandboxHostError
	>;
	readonly clearUserEntityData?: () => Effect.Effect<
		{ readonly deletedEventsCount: number; readonly deletedRelationshipsCount: number },
		SandboxHostError
	>;
}) => {
	const clears: { readonly args: unknown }[] = [];
	const merges: { readonly args: unknown }[] = [];
	const host = defineSandboxTestHost(manifest, {
		mergeUserEntityData: (args) =>
			Effect.suspend(() => {
				merges.push({ args });
				return (
					input?.mergeUserEntityData?.() ??
					Effect.succeed({ movedEventsCount: 4, movedRelationshipsCount: 5 })
				);
			}),
		clearUserEntityData: (args) =>
			Effect.suspend(() => {
				clears.push({ args });
				return (
					input?.clearUserEntityData?.() ??
					Effect.succeed({ deletedEventsCount: 2, deletedRelationshipsCount: 3 })
				);
			}),
	});
	return { host, clears, merges };
};

describe("media user data operation", () => {
	it.live(
		"clears one media graph with its submission identity",
		() =>
			Effect.gen(function* () {
				const { host, clears, merges } = recordingHost();
				expect(
					yield* runSandboxTestScript(
						definition,
						{
							submittedAt,
							submissionId,
							action: "remove",
							entityId: "media-1",
							entitySchemaSlug: "movie",
						},
						host,
						execution,
					),
				).toEqual({ count: 5, status: "saved" });
				expect(clears).toEqual([{ args: { entityId: "media-1", entitySchemaSlug: "movie" } }]);
				expect(merges).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"merges one media graph",
		() =>
			Effect.gen(function* () {
				const { host, clears, merges } = recordingHost();
				expect(
					yield* runSandboxTestScript(
						definition,
						{
							submittedAt,
							submissionId,
							action: "merge",
							mergeFrom: "source-1",
							mergeInto: "target-1",
							entitySchemaSlug: "show",
						},
						host,
						execution,
					),
				).toEqual({ count: 9, status: "saved" });
				expect(merges).toEqual([
					{ args: { mergeFrom: "source-1", mergeInto: "target-1", entitySchemaSlug: "show" } },
				]);
				expect(clears).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"uses the shared library-member schema allow-list for both actions",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost();
				for (const entitySchemaSlug of mediaLibraryMemberEntitySchemaSlugs) {
					expect(
						yield* runSandboxTestScript(
							definition,
							{
								submittedAt,
								submissionId,
								action: "remove",
								entitySchemaSlug,
								entityId: "media-1",
							},
							host,
							execution,
						),
					).toMatchObject({ status: "saved" });
					expect(
						yield* runSandboxTestScript(
							definition,
							{
								submittedAt,
								submissionId,
								action: "merge",
								entitySchemaSlug,
								mergeFrom: "source-1",
								mergeInto: "target-1",
							},
							host,
							execution,
						),
					).toMatchObject({ status: "saved" });
				}
			}),
		testTimeout,
	);

	it.live(
		"returns the actionable child mapping refusal from the host",
		() =>
			Effect.gen(function* () {
				const message = "Cannot merge child data. Match episode names and try again.";
				const { host } = recordingHost({
					mergeUserEntityData: () =>
						Effect.fail({
							message: "child-mapping-conflict",
							data: { message, code: "child-mapping-conflict" },
						}),
				});
				expect(
					yield* runSandboxTestScript(
						definition,
						{
							submittedAt,
							submissionId,
							action: "merge",
							mergeFrom: "source-1",
							mergeInto: "target-1",
							entitySchemaSlug: "show",
						},
						host,
						execution,
					),
				).toEqual({ message, status: "rejected" });
			}),
		testTimeout,
	);

	it.live(
		"returns state conflicts with their actionable host message",
		() =>
			Effect.gen(function* () {
				const message = "Your data changed. Refresh and try again.";
				const { host } = recordingHost({
					clearUserEntityData: () =>
						Effect.fail({ message: "state-conflict", data: { message, code: "state-conflict" } }),
				});
				expect(
					yield* runSandboxTestScript(
						definition,
						{
							submittedAt,
							submissionId,
							action: "remove",
							entityId: "media-1",
							entitySchemaSlug: "movie",
						},
						host,
						execution,
					),
				).toEqual({ message, status: "rejected" });
			}),
		testTimeout,
	);

	it.live(
		"keeps infrastructure failures retryable",
		() =>
			Effect.gen(function* () {
				const failure = { message: "database unavailable" };
				const { host } = recordingHost({ clearUserEntityData: () => Effect.fail(failure) });
				const result = yield* Effect.result(
					runSandboxTestScript(
						definition,
						{
							submittedAt,
							submissionId,
							action: "remove",
							entityId: "media-1",
							entitySchemaSlug: "movie",
						},
						host,
						execution,
					),
				);
				expect(result).toMatchObject({ failure, _tag: "Failure" });
			}),
		testTimeout,
	);
});
