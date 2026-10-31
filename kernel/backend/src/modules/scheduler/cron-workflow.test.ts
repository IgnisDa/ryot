import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { runTasks } from "./cron-workflow";
import type { CronTask } from "./types";

it.effect("swallows a task failure and still runs the remaining tasks", () => {
	const ran: string[] = [];

	const failing: CronTask<string, never> = {
		name: "boom",
		run: () =>
			Effect.sync(() => {
				ran.push("boom");
			}).pipe(Effect.flatMap(() => Effect.fail("nope"))),
	};

	const ok: CronTask<never, never> = {
		name: "ok",
		run: () =>
			Effect.sync(() => {
				ran.push("ok");
			}),
	};

	return Effect.gen(function* () {
		const result = yield* runTasks([failing, ok], { executionId: "exec-x" });

		expect(result).toBeUndefined();
		expect(ran).toContain("boom");
		expect(ran).toContain("ok");
	});
});
