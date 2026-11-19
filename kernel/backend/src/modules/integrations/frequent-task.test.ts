import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { JobQueue } from "#platform/jobs/queue";

import { integrationsFrequentTask } from "./frequent-task";

it.effect(
	"queues one coalesced sync for every user",
	() =>
		Effect.gen(function* () {
			const queued: unknown[] = [];
			yield* integrationsFrequentTask.run({ executionId: "exec-int" }).pipe(
				Effect.provideService(
					JobQueue,
					JobQueue.of({
						pruneFailed: () => Effect.void,
						enqueue: (kind, payload, options) =>
							Effect.sync(() => {
								queued.push({ payload, options, kind: kind.name });
								return true;
							}),
					}),
				),
			);
			expect(queued).toEqual([
				{ options: { key: "all" }, kind: "integration-sync", payload: { userId: null } },
			]);
		}),
	testTimeout,
);

it.effect(
	"swallows an enqueue failure so the cron tick keeps running",
	() =>
		Effect.gen(function* () {
			const exit = yield* integrationsFrequentTask
				.run({ executionId: "exec-int" })
				.pipe(
					Effect.provideService(
						JobQueue,
						JobQueue.of({
							pruneFailed: () => Effect.void,
							enqueue: () => Effect.die("enqueue boom"),
						}),
					),
					Effect.exit,
				);
			expect(exit._tag).toBe("Success");
		}),
	testTimeout,
);
