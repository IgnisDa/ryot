import { describe, expect, it } from "vitest";

import {
	createImportWizardState,
	importWizardReducer,
	importWizardStepLabel,
} from "./start-wizard-state";

const advanceToReview = (slug: string) =>
	importWizardReducer(
		importWizardReducer(createImportWizardState(), { slug, type: "source-chosen" }),
		{ type: "review-requested" },
	);

describe("import wizard state", () => {
	it("starts at the service choice with nothing selected", () => {
		expect(createImportWizardState()).toEqual({ step: "source", sourceSlug: undefined });
	});

	it("advances to the inputs as soon as a service is chosen", () => {
		expect(
			importWizardReducer(createImportWizardState(), { type: "source-chosen", slug: "archive" }),
		).toEqual({ step: "input", sourceSlug: "archive" });
	});

	it("moves to the review only from the inputs", () => {
		expect(advanceToReview("archive")).toEqual({ step: "review", sourceSlug: "archive" });
		expect(importWizardReducer(createImportWizardState(), { type: "review-requested" })).toEqual({
			step: "source",
			sourceSlug: undefined,
		});
	});

	it("walks back one step at a time and stops at the first step", () => {
		const review = advanceToReview("archive");
		const input = importWizardReducer(review, { type: "back" });
		const source = importWizardReducer(input, { type: "back" });

		expect(input).toEqual({ step: "input", sourceSlug: "archive" });
		expect(source).toEqual({ step: "source", sourceSlug: "archive" });
		expect(importWizardReducer(source, { type: "back" })).toEqual(source);
	});

	it("keeps the chosen service when returning and replaces it when another is chosen", () => {
		const source = importWizardReducer(advanceToReview("archive"), { type: "back" });
		const rechosen = importWizardReducer(source, { type: "source-chosen", slug: "ledger" });

		expect(rechosen).toEqual({ step: "input", sourceSlug: "ledger" });
		expect(importWizardReducer(rechosen, { type: "reset" })).toEqual(createImportWizardState());
	});

	it("recovers at the step that can fix the problem, and never without a service", () => {
		const review = advanceToReview("archive");

		expect(importWizardReducer(review, { type: "recover-at", step: "input" })).toEqual({
			step: "input",
			sourceSlug: "archive",
		});
		expect(importWizardReducer(review, { type: "recover-at", step: "source" })).toEqual({
			step: "source",
			sourceSlug: "archive",
		});
		expect(
			importWizardReducer(createImportWizardState(), { type: "recover-at", step: "input" }),
		).toEqual(createImportWizardState());
	});

	it("numbers each step of the real sequence", () => {
		expect(importWizardStepLabel("source")).toBe("Step 1 of 3 · Choose a service");
		expect(importWizardStepLabel("input")).toBe("Step 2 of 3 · Provide the details");
		expect(importWizardStepLabel("review")).toBe("Step 3 of 3 · Review and start");
	});
});
