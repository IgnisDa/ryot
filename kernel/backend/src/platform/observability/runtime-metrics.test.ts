import { describe, expect, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import { recordHttpAdmissionTicket, recordSandboxWorkflowReplayFinished } from "./runtime-metrics";

const withIsolatedRegistry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, Metric.MetricRegistry, new Map());

const findSnapshot = (id: string, attributes: Record<string, string>) =>
	Effect.map(Metric.snapshot, (snapshots) =>
		snapshots.find(
			(snapshot) =>
				snapshot.id === id &&
				Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
		),
	);

describe("backend runtime metrics", () => {
	it.effect("records HTTP admission tickets by lane, policy and outcome only", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				yield* recordHttpAdmissionTicket({
					waitedMs: 250,
					outcome: "granted",
					lane: "interactive",
					policy: "musicbrainz",
				});
				yield* recordHttpAdmissionTicket({
					lane: "background",
					outcome: "overloaded",
					policy: "musicbrainz",
				});
				const granted = yield* findSnapshot("ryot.http_admission.tickets", {
					outcome: "granted",
					lane: "interactive",
					policy: "musicbrainz",
				});
				const wait = yield* findSnapshot("ryot.http_admission.ticket_wait", {
					lane: "interactive",
					policy: "musicbrainz",
				});
				const overloaded = yield* findSnapshot("ryot.http_admission.tickets", {
					lane: "background",
					outcome: "overloaded",
				});
				expect(granted?.state).toMatchObject({ count: 1 });
				expect(wait?.state).toMatchObject({ count: 1, sum: 250 });
				expect(overloaded?.state).toMatchObject({ count: 1 });
				expect(Object.keys(granted?.attributes ?? {}).sort()).toEqual([
					"lane",
					"outcome",
					"policy",
					"unit",
				]);
			}),
		),
	);

	it.effect("records a replay outcome and journal size", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				yield* recordSandboxWorkflowReplayFinished({
					durationMs: 12,
					kind: "workflow",
					journalEntries: 1,
					journalBytes: 512,
					outcome: "pending",
				});
				const replays = yield* findSnapshot("ryot.sandbox.workflow_replays", {
					kind: "workflow",
					outcome: "pending",
				});
				const journal = yield* findSnapshot("ryot.sandbox.workflow_journal_size", {
					kind: "workflow",
				});
				expect(replays?.state).toMatchObject({ count: 1 });
				expect(journal?.state).toMatchObject({ count: 1, sum: 512 });
			}),
		),
	);
});
