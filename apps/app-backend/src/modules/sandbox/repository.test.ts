import type { WorkflowDurableCallRequest } from "@ryot/sandbox-sdk/workflow";
import { describe, expect, it } from "vitest";

import { isWorkflowCallTargetKind } from "./repository";

const activity = {
	index: 0,
	name: "activity",
	kind: "activity",
	args: { input: {}, scriptSlug: "activity.test" },
} satisfies WorkflowDurableCallRequest;

describe("workflow call script resolution", () => {
	it("dispatches activities to activity and migrated script definitions", () => {
		expect(isWorkflowCallTargetKind(activity, "activity")).toBe(true);
		expect(isWorkflowCallTargetKind(activity, "script")).toBe(true);
		for (const kind of ["operation", "workflow", "provider", "automation"] as const) {
			expect(isWorkflowCallTargetKind(activity, kind)).toBe(false);
		}
	});

	it("dispatches children only to workflow scripts", () => {
		const child = {
			index: 0,
			name: "child",
			kind: "child",
			args: { input: {}, workflowSlug: "workflow.test" },
		} satisfies WorkflowDurableCallRequest;
		expect(isWorkflowCallTargetKind(child, "workflow")).toBe(true);
		expect(isWorkflowCallTargetKind(child, "activity")).toBe(false);
	});
});
