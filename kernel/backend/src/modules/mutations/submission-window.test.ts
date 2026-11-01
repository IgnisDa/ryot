import { expect, it } from "@effect/vitest";
import { SubmissionExpired } from "@ryot-app/contract/errors";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { requireOpenSubmission } from "./submission-window";

const now = Date.parse("2026-10-28T00:00:00.000Z");
const days = (count: number) => new Date(now + count * 86_400_000).toISOString();
const expired = new SubmissionExpired({
	message: "Submission expired; retry with a new idempotency key",
});

it.effect("accepts submissions within seven days of the server clock in either direction", () =>
	Effect.gen(function* () {
		yield* TestClock.setTime(now);
		for (const submittedAt of [days(-7), days(0), days(7)]) {
			expect(yield* requireOpenSubmission(submittedAt)).toBeUndefined();
		}
		for (const submittedAt of [days(-7.01), days(7.01)]) {
			assertExitFails(yield* Effect.exit(requireOpenSubmission(submittedAt)), expired);
		}
	}),
);
