import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { execution } from "../../tests/backend/automations/automation-test-utils";
import { HistoryCorrectionRequest } from "../contracts/history-correction";
import definition, { manifest } from "./media-history-correction.sandbox";

const input = {
	force: true,
	conflictAttempt: 3,
	entityId: "subject",
	workKey: "older-work",
	requestKey: "request",
	liveSourceIds: ["source"],
	conflictBase: "older-work",
};

it.live.each(["entity-stale", "event-stale", "event-not-found", "mutation-conflict"])(
	"yields durable continuation after repeated %s conflicts instead of failing independent work",
	(code) =>
		Effect.gen(function* () {
			let attempts = 0;
			const requests: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				requestUserWork: (request, reference) =>
					Effect.sync(() => {
						requests.push({ request, reference });
						return { workId: "continuation" };
					}),
				executeRyotql: (document) => {
					if ("mediaLibrary" in document.queries) {
						return Effect.succeed({
							data: {
								mediaLibrary: {
									type: "rows",
									items: [{ entityId: "library" }],
									pageInfo: { limit: 2, hasMore: false, nextCursor: null },
								},
							},
						});
					}
					attempts += 1;
					return Effect.fail({ message: code, data: { code } });
				},
			});
			expect(yield* runSandboxTestScript(definition, input, host, execution)).toBeNull();
			expect(attempts).toBe(6);
			expect(requests).toHaveLength(1);
			expect(requests).toMatchObject([
				{
					reference: { referenceKind: "script", scriptSlug: "media-history-correction" },
					request: {
						scope: "subject",
						key: "older-work:conflict:4",
						input: {
							...input,
							force: false,
							conflictAttempt: 4,
							conflictBase: "older-work",
							workKey: "older-work:conflict:4",
						},
					},
				},
			]);
		}),
);

const libraryReply = {
	data: {
		mediaLibrary: {
			type: "rows" as const,
			items: [{ entityId: "library" }],
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
		},
	},
};

it.live("fails after ten consecutive no-progress requeues with unique keys", () =>
	Effect.gen(function* () {
		const requests: Array<{ key: string; input: unknown }> = [];
		const host = defineSandboxTestHost(manifest, {
			requestUserWork: (request) =>
				Effect.sync(() => {
					requests.push({ key: request.key, input: request.input });
					return { workId: "continuation" };
				}),
			executeRyotql: (document) =>
				"mediaLibrary" in document.queries
					? Effect.succeed(libraryReply)
					: Effect.fail({ message: "stale", data: { code: "event-stale" } }),
		});
		let current: typeof HistoryCorrectionRequest.Type = {
			...input,
			workKey: "start",
			conflictAttempt: 0,
			conflictBase: "start",
		};
		for (let run = 1; run <= 10; run += 1) {
			expect(yield* runSandboxTestScript(definition, current, host, execution)).toBeNull();
			expect(requests).toHaveLength(run);
			current = yield* Schema.decodeUnknownEffect(HistoryCorrectionRequest)(
				requests[run - 1]?.input,
			);
		}
		expect(new Set(requests.map(({ key }) => key)).size).toBe(10);
		expect(requests.at(-1)?.key).toBe("start:conflict:10");
		const failure = yield* Effect.flip(runSandboxTestScript(definition, current, host, execution));
		expect(failure).toMatchObject({
			message: "History correction kept conflicting with concurrent changes",
		});
		expect(requests).toHaveLength(10);
	}),
);

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

it.live("never fails while stale bursts alternate with committed steps", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		let commits = 0;
		const host = defineSandboxTestHost(manifest, {
			requestUserWork: (request) =>
				Effect.sync(() => {
					requests.push(request.input);
					return { workId: "continuation" };
				}),
			commitUserChanges: () =>
				Effect.suspend(() => {
					commits += 1;
					return commits % 7 === 1
						? Effect.succeed({ events: [], entityId: EntityId.make("library") })
						: Effect.fail({ message: "stale", data: { code: "event-stale" } });
				}),
			executeRyotql: (document) => {
				if ("mediaLibrary" in document.queries) {
					return Effect.succeed(libraryReply);
				}
				return Effect.succeed({
					data: {
						work: page([]),
						scope: page([{ revision: 4 }]),
						target: page([{ properties: {}, schemaSlug: "movie" }]),
						library: page([
							{ properties: {}, name: "Library", updatedAt: "2026-01-01T00:00:00.000Z" },
						]),
					},
				});
			},
		});
		let current: typeof HistoryCorrectionRequest.Type = {
			...input,
			force: false,
			workKey: "start",
			conflictAttempt: 0,
			conflictBase: "start",
		};
		for (let run = 1; run <= 12; run += 1) {
			expect(yield* runSandboxTestScript(definition, current, host, execution)).toBeNull();
			expect(requests).toHaveLength(run);
			current = yield* Schema.decodeUnknownEffect(HistoryCorrectionRequest)(requests[run - 1]);
			expect(current.conflictAttempt).toBe(1);
		}
		expect(commits).toBe(84);
	}),
);
