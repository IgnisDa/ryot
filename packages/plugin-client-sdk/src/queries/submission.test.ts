import { describe, expect, it } from "@effect/vitest";

import { createRyotSubmission } from "./submission";

describe("retryable submissions", () => {
	it("retains an immutable snapshot and identity across failures and blocks double submission", () => {
		let sequence = 0;
		const controller = createRyotSubmission<{ values: number[] }>(
			() => `submission-${++sequence}`,
			() => Date.parse("2026-10-15T08:00:00Z"),
		);
		const input = { values: [0, 72.5] };
		const submission = controller.start(input);
		input.values.push(99);
		expect(submission).toEqual({
			submissionId: "submission-1",
			input: { values: [0, 72.5] },
			submittedAt: "2026-10-15T08:00:00.000Z",
		});
		expect(controller.start(input)).toBeNull();
		expect(controller.retry()).toBeNull();
		expect(controller.abandon()).toBe(false);
		controller.settle(false);
		expect(controller.start(input)).toBeNull();
		expect(controller.retry()).toBe(submission);
		controller.settle(false);
		expect(controller.retry()).toBe(submission);
		controller.settle(true);
		expect(controller.getSnapshot()).toEqual({ status: "idle", submission: null });
		expect(controller.start(input)?.submissionId).toBe("submission-2");
	});

	it("abandons retained work explicitly and notifies subscribers only until disposal", () => {
		const controller = createRyotSubmission<string>(
			() => "submission",
			() => Date.parse("2026-10-15T08:00:00Z"),
		);
		const statuses: string[] = [];
		const unsubscribe = controller.subscribe(() => statuses.push(controller.getSnapshot().status));
		controller.start("value");
		controller.settle(false);
		expect(controller.abandon()).toBe(true);
		expect(controller.getSnapshot().submission).toBeNull();
		unsubscribe();
		controller.start("another");
		expect(statuses).toEqual(["pending", "retained", "idle"]);
	});
});
