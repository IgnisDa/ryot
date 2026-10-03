import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { SetGrid } from "./set-grid";

const roots: Root[] = [];

const mount = () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	return (node: ReactNode) => act(() => root.render(node));
};

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.innerHTML = "";
});

const set: WorkoutEditorSet = {
	reps: "8",
	weight: "20",
	included: false,
	setLot: "normal",
	clientId: "set-1",
	exerciseKind: "reps_and_weight",
	restChoice: { kind: "inherited" },
};

const occurrence: WorkoutEditorOccurrence = {
	notes: [],
	images: [],
	videos: [],
	sets: [set],
	isCollapsed: false,
	clientId: "occurrence-1",
	exerciseKind: "reps_and_weight",
	exerciseId: EntityId.make("exercise-1"),
};

const draft: WorkoutEditorDraft = {
	images: [],
	videos: [],
	supersets: [],
	name: "Workout",
	draftId: "draft-1",
	mode: { kind: "live" },
	displayEnergyUnit: "kcal",
	occurrences: [occurrence],
	activeDurationIntent: "set",
	kind: "fitness-workout-editor",
};

describe("SetGrid", () => {
	it("uses numeric input for reps, decimal for other measurements, and selects values on focus", () => {
		mount()(
			<SetGrid
				now={0}
				draft={draft}
				compact={false}
				disabled={false}
				invalid={undefined}
				previous={new Map()}
				occurrence={occurrence}
				countdownEnabled={false}
				currentSetId={undefined}
				onStart={() => undefined}
				onChange={() => undefined}
				onOpenSet={() => undefined}
				onComplete={() => undefined}
				restSeconds={() => undefined}
				onCopyPrevious={() => undefined}
			/>,
		);

		const reps = screen.getByRole("textbox", { name: "Set 1 reps" });
		assert(reps instanceof HTMLInputElement);
		const weight = screen.getByRole("textbox", { name: "Set 1 weight (kg)" });
		expect(reps.inputMode).toBe("numeric");
		expect(weight.getAttribute("inputmode")).toBe("decimal");

		act(() => {
			fireEvent.focusIn(reps);
		});
		expect(reps.selectionStart).toBe(0);
		expect(reps.selectionEnd).toBe(reps.value.length);
	});
});
