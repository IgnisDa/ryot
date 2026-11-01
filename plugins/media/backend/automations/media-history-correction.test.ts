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

const libraryReply = {
	data: {
		mediaLibrary: {
			type: "rows" as const,
			items: [{ entityId: "library" }],
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
		},
	},
};

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const contextReply = {
	data: {
		work: page([]),
		scope: page([{ revision: 4 }]),
		library: page([{ properties: {}, name: "Library", updatedAt: "2026-01-01T00:00:00.000Z" }]),
		target: page([
			{
				properties: {},
				schemaSlug: "movie",
				hasCorrectionInputs: true,
				missingDependencies: false,
			},
		]),
	},
};

const correctionHost = (
	commit: () => Effect.Effect<void, string>,
	requests: Array<{ readonly key: string; readonly input: unknown; readonly reference: unknown }>,
) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: (document) =>
			Effect.succeed("mediaLibrary" in document.queries ? libraryReply : contextReply),
		commitUserChanges: () =>
			commit().pipe(
				Effect.as({ events: [], entityId: EntityId.make("library") }),
				Effect.mapError((code) => ({ message: code, data: { code } })),
			),
		requestUserWork: (request, reference) =>
			Effect.sync(() => {
				requests.push({ reference, key: request.key, input: request.input });
				return { workId: "continuation" };
			}),
	});

it.live.each(["entity-stale", "event-stale", "event-not-found", "mutation-conflict"])(
	"re-queues durable work after a %s commit conflict without retrying inline",
	(code) =>
		Effect.gen(function* () {
			let commits = 0;
			const requests: Parameters<typeof correctionHost>[1] = [];
			const host = correctionHost(
				() =>
					Effect.suspend(() => {
						commits += 1;
						return Effect.fail(code);
					}),
				requests,
			);
			expect(yield* runSandboxTestScript(definition, input, host, execution)).toBeNull();
			expect(commits).toBe(1);
			expect(requests).toMatchObject([
				{
					key: "older-work:conflict:4",
					reference: { referenceKind: "script", scriptSlug: "media-history-correction" },
					input: {
						...input,
						force: false,
						conflictAttempt: 4,
						conflictBase: "older-work",
						workKey: "older-work:conflict:4",
					},
				},
			]);
		}),
);

it.live("fails other commit errors instead of re-queueing them", () =>
	Effect.gen(function* () {
		const requests: Parameters<typeof correctionHost>[1] = [];
		const host = correctionHost(() => Effect.fail("policy-rejected"), requests);
		const failure = yield* Effect.flip(runSandboxTestScript(definition, input, host, execution));
		expect(failure).toMatchObject({ message: "policy-rejected" });
		expect(requests).toEqual([]);
	}),
);

it.live("fails after ten consecutive no-progress requeues with unique keys", () =>
	Effect.gen(function* () {
		const requests: Parameters<typeof correctionHost>[1] = [];
		const host = correctionHost(() => Effect.fail("event-stale"), requests);
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

it.live("resets the conflict budget after each committed step", () =>
	Effect.gen(function* () {
		const requests: Parameters<typeof correctionHost>[1] = [];
		let commits = 0;
		const host = correctionHost(
			() =>
				Effect.suspend(() => {
					commits += 1;
					return commits % 2 === 1 ? Effect.void : Effect.fail("event-stale");
				}),
			requests,
		);
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
			current = yield* Schema.decodeUnknownEffect(HistoryCorrectionRequest)(
				requests[run - 1]?.input,
			);
			expect(current.conflictAttempt).toBe(1);
		}
		expect(commits).toBe(24);
	}),
);
