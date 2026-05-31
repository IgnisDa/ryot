import { describe, expect, it } from "vitest";

import { initialConnectionState, reduceConnectionState } from "./connection-state";

describe("connection state", () => {
	it("allows a failed health check to retry through the same workflow", () => {
		const checking = reduceConnectionState(initialConnectionState, { type: "started" });
		const failed = reduceConnectionState(checking, { type: "failed" });
		const retrying = reduceConnectionState(failed, { type: "started" });
		const connected = reduceConnectionState(retrying, { type: "succeeded" });

		expect([checking.status, failed.status, retrying.status, connected.status]).toEqual([
			"checking",
			"error",
			"checking",
			"success",
		]);
	});

	it("clears a previous result when connection details change", () => {
		expect(reduceConnectionState({ status: "error" }, { type: "changed" })).toEqual({
			status: "idle",
		});
	});
});
