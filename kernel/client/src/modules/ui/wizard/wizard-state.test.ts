import { describe, expect, it } from "vitest";

import { createWizardState, WIZARD_STEPS, wizardReducer, wizardStepLabel } from "./wizard-state";

const headings = {
	pick: "Choose a service",
	review: "Review and start",
	configure: "Provide the details",
};

const initial = createWizardState();

const picked = wizardReducer(initial, { type: "picked", slug: "netflix" });

describe("wizard state", () => {
	it("starts at the picker with no selected service", () => {
		expect(initial).toEqual({ step: "pick", slug: undefined });
	});

	it("numbers each step for the header", () => {
		expect(wizardStepLabel("pick", WIZARD_STEPS, headings)).toBe("Step 1 of 3 · Choose a service");
		expect(wizardStepLabel("review", WIZARD_STEPS, headings)).toBe(
			"Step 3 of 3 · Review and start",
		);
	});

	it("advances from a picked service through review", () => {
		expect(picked).toEqual({ slug: "netflix", step: "configure" });
		expect(wizardReducer(picked, { type: "review-requested" }).step).toBe("review");
	});

	it("only reviews once something has been picked", () => {
		expect(wizardReducer(initial, { type: "review-requested" })).toEqual(initial);
	});

	it("walks back one step at a time and stops at the picker", () => {
		const reviewing = wizardReducer(picked, { type: "review-requested" });

		expect(wizardReducer(reviewing, { type: "back" }).step).toBe("configure");
		expect(wizardReducer(picked, { type: "back" }).step).toBe("pick");
		expect(wizardReducer(initial, { type: "back" }).step).toBe("pick");
	});

	it("recovers at a step only while something is held", () => {
		expect(wizardReducer(picked, { step: "pick", type: "recover-at" }).step).toBe("pick");
		expect(wizardReducer(initial, { step: "configure", type: "recover-at" })).toEqual(initial);
	});
});
