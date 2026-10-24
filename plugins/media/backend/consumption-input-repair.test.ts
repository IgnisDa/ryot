import { expect, it } from "@effect/vitest";
import type { ScriptHost, UserCommandInput } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { objectContaining } from "@ryot-app/testing/matchers";

import type { HistoryCorrection } from "../shared/history-correction";
import definition, { manifest } from "./consumption-input-repair.sandbox";
import { historyCorrectionReference } from "./contracts/history-correction";

const timestamp = "2026-01-01T00:00:00.000Z";
const execution = { metadata: {}, startedAt: timestamp, sandboxScriptId: "script-test" };
const input = { entityId: "subject", requestKey: "repair-epoch" };
const page = (items: readonly unknown[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const reply = (name: string, items: readonly unknown[]) => ({ data: { [name]: page(items) } });
const record = (properties: JsonValue, id = "checkpoint") => ({
	id,
	properties,
	revision: 0,
	occurredAt: timestamp,
});
const checkpoint = (patch: Partial<HistoryCorrection> = {}): HistoryCorrection => ({
	step: 4,
	cycle: 0,
	phase: "done",
	sourceRevision: 0,
	liveSourceIds: [],
	runKey: "older-run",
	workKey: "older-work",
	subjectEntityId: "subject",
	requestKey: "older-request",
	...patch,
});

const inventory = {
	total: 60,
	required: 58,
	latestSeason: timestamp,
	latestEpisode: timestamp,
	subjectUpdatedAt: timestamp,
	latestLink: "2026-01-02T00:00:00.000Z",
};

const harness = (
	options: {
		schemaSlug?: string;
		state?: HistoryCorrection;
		recordResponses?: readonly (readonly unknown[])[];
		commitFailure?: { readonly message: string; readonly data?: JsonValue };
	} = {},
) => {
	const commands: UserCommandInput[] = [];
	const requests: Array<{
		request: Parameters<ScriptHost["requestUserWork"]>[0];
		reference: Parameters<ScriptHost["requestUserWork"]>[1];
	}> = [];
	const queryKeys: string[][] = [];
	const recordResponses = [...(options.recordResponses ?? [[]])];
	let commitAttempts = 0;
	const host = defineSandboxTestHost(manifest, {
		requestUserWork: (request, reference) =>
			Effect.sync(() => {
				requests.push({ request, reference });
				return { workId: "continuation" };
			}),
		commitUserChanges: (command) => {
			commands.push(command);
			commitAttempts += 1;
			if (options.commitFailure) {
				return Effect.fail(options.commitFailure);
			}
			return Effect.succeed({ events: [], entityId: EntityId.make("library") });
		},
		executeRyotql: (document) => {
			queryKeys.push(Object.keys(document.queries));
			if ("mediaLibrary" in document.queries) {
				return Effect.succeed(reply("mediaLibrary", [{ entityId: "library" }]));
			}
			if ("scope" in document.queries) {
				return Effect.succeed({
					data: {
						scope: page([{ revision: 0 }]),
						work: page(options.state ? [record(options.state)] : []),
						library: page([{ properties: {}, name: "Library", updatedAt: timestamp }]),
						target: page([
							{
								properties: {},
								missingDependencies: false,
								schemaSlug: options.schemaSlug ?? "movie",
							},
						]),
					},
				});
			}
			if ("fingerprint" in document.queries) {
				return Effect.succeed(reply("fingerprint", [inventory]));
			}
			if ("records" in document.queries) {
				return Effect.succeed(reply("records", recordResponses.shift() ?? []));
			}
			throw new Error("Unexpected history correction query");
		},
	});
	const run = () => runSandboxTestScript(definition, input, host, execution);
	return { run, host, commands, requests, queryKeys, commitAttempts: () => commitAttempts };
};

it.effect("commits a fresh checkpoint for a new request after a stale completed marker", () =>
	Effect.gen(function* () {
		const test = harness({ state: checkpoint() });
		expect(yield* test.run()).toBeNull();
		expect(test.commitAttempts()).toBe(1);
		expect(test.queryKeys).toHaveLength(2);
		expect(test.commands[0]?.events.creates).toEqual([]);
		expect(test.commands[0]?.events.changes).toMatchObject([
			{
				itemIdentity: "replace:checkpoint",
				item: {
					patch: {
						properties: {
							set: {
								phase: "audit",
								liveSourceIds: [],
								sourceRevision: 0,
								requestKey: input.requestKey,
							},
						},
					},
				},
			},
		]);
		expect(test.requests).toHaveLength(1);
	}),
);

it.effect("queues one scoped continuation after the successful initial step", () =>
	Effect.gen(function* () {
		const test = harness({ state: checkpoint() });
		yield* test.run();
		expect(test.requests).toMatchObject([
			{
				reference: historyCorrectionReference,
				request: {
					scope: input.entityId,
					key: "subject:repair-epoch:0:1",
					input: {
						...input,
						force: false,
						liveSourceIds: [],
						conflictAttempt: 0,
						workKey: "subject:repair-epoch:0:1",
						conflictBase: "subject:repair-epoch:0:1",
					},
				},
			},
		]);
	}),
);

it.effect("does not enqueue work when its successful initial step finishes correction", () =>
	Effect.gen(function* () {
		const test = harness({ state: checkpoint({ phase: "clear", requestKey: input.requestKey }) });
		yield* test.run();
		expect(test.commitAttempts()).toBe(1);
		expect(test.commands[0]?.events.changes).toMatchObject([
			{
				itemIdentity: "replace:checkpoint",
				item: { patch: { properties: { set: { phase: "done" } } } },
			},
		]);
		expect(test.requests).toEqual([]);
	}),
);

it.effect("fails after five stale retries instead of admitting work without a committed step", () =>
	Effect.gen(function* () {
		const test = harness({
			state: checkpoint(),
			commitFailure: { message: "stale", data: { code: "event-stale" } },
		});
		const failure = yield* Effect.flip(test.run());
		expect(failure).toMatchObject({ message: "stale" });
		expect(test.commitAttempts()).toBe(6);
		expect(test.requests).toEqual([]);
	}),
);

it.effect("propagates unrelated initial-step failures without retry or continuation", () =>
	Effect.gen(function* () {
		const test = harness({
			state: checkpoint(),
			commitFailure: { message: "storage unavailable" },
		});
		const failure = yield* Effect.flip(test.run());
		expect(failure).toMatchObject({ message: "storage unavailable" });
		expect(test.commitAttempts()).toBe(1);
		expect(test.requests).toEqual([]);
	}),
);

it.effect("resets stale episode evidence without rewriting the source or frozen basis", () =>
	Effect.gen(function* () {
		const basis = {
			total: 58,
			frozen: true,
			silent: true,
			rule: "coverage",
			status: "active",
			runKey: "repair-epoch:0",
			entityId: input.entityId,
			subjectEntityId: input.entityId,
			sourceEventId: "original-source",
		};
		const test = harness({
			schemaSlug: "show",
			state: checkpoint({
				basisId: "basis",
				phase: "reset-snapshot",
				inventory: "stale-inventory",
				requestKey: input.requestKey,
			}),
			recordResponses: [
				[record(basis, "basis")],
				[
					record(
						{
							episodeId: "episode",
							occurrenceId: "basis",
							subjectEntityId: input.entityId,
							sourceEventId: "original-source",
						},
						"evidence",
					),
				],
			],
		});
		yield* test.run();
		expect(test.commands[0]?.events.creates).toEqual([]);
		expect(test.commands[0]?.events.changes.map((change) => change.itemIdentity)).toEqual([
			"remove:evidence",
			"replace:checkpoint",
		]);
		expect(test.commands[0]?.events.changes).not.toContainEqual(
			objectContaining({ itemIdentity: "replace:basis" }),
		);
		expect(test.queryKeys.map((keys) => keys[0])).toEqual([
			"mediaLibrary",
			"scope",
			"records",
			"fingerprint",
			"records",
		]);
		expect(test.requests).toHaveLength(1);
	}),
);
