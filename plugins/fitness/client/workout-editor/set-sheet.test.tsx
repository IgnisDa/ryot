import { afterEach, describe, expect, it } from "@effect/vitest";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { Effect } from "effect";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { SetSheet } from "./set-sheet";

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

const makeSet = (included: boolean, clientId = "set-1"): WorkoutEditorSet => ({
	clientId,
	included,
	reps: "8",
	weight: "20",
	setLot: "normal",
	exerciseKind: "reps_and_weight",
	restChoice: { kind: "inherited" },
});

const makeOccurrence = (set: WorkoutEditorSet): WorkoutEditorOccurrence => ({
	notes: [],
	images: [],
	videos: [],
	sets: [set],
	isCollapsed: false,
	clientId: "occurrence-1",
	exerciseKind: "reps_and_weight",
	exerciseId: EntityId.make("exercise-1"),
});

const makeDraft = (occurrence: WorkoutEditorOccurrence): WorkoutEditorDraft => ({
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
});

const propsFor = (
	set: WorkoutEditorSet,
	overrides: Partial<Parameters<typeof SetSheet>[0]> = {},
): Parameters<typeof SetSheet>[0] => {
	const occurrence = makeOccurrence(set);
	return {
		set,
		pro: false,
		occurrence,
		compact: false,
		disabled: false,
		safeAreaBottom: 0,
		previous: undefined,
		inheritedRestSeconds: 60,
		onClose: () => undefined,
		onChange: () => undefined,
		onDelete: () => undefined,
		exerciseName: "Bench press",
		draft: makeDraft(occurrence),
		onCopyPrevious: () => undefined,
		...overrides,
	};
};

const click = (element: Element) =>
	act(() => {
		fireEvent.click(element);
	});

describe("SetSheet", () => {
	it("deletes incomplete sets directly", () => {
		const deleted: string[] = [];
		mount()(<SetSheet {...propsFor(makeSet(false), { onDelete: () => deleted.push("set") })} />);

		click(screen.getByRole("button", { name: "Delete set" }));

		expect(deleted).toEqual(["set"]);
		expect(screen.queryByRole("dialog", { name: "Delete completed set?" })).toBeNull();
	});

	it.live("asks before deleting a completed set and cancel changes nothing", () =>
		Effect.gen(function* () {
			const deleted: string[] = [];
			mount()(<SetSheet {...propsFor(makeSet(true), { onDelete: () => deleted.push("set") })} />);

			click(screen.getByRole("button", { name: "Delete set" }));

			const confirmation = screen.getByRole("dialog", { name: "Delete completed set?" });
			expect(
				within(confirmation).getByText(
					"This completed set will be removed. This action cannot be undone.",
				),
			).toBeTruthy();
			click(within(confirmation).getByRole("button", { name: "Cancel" }));

			expect(deleted).toEqual([]);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.queryByRole("dialog", { name: "Delete completed set?" })).toBeNull(),
				),
			);
		}),
	);

	it("confirms only for the current completed set while enabled and uses the latest callback", () => {
		const deleted: string[] = [];
		const render = mount();
		render(<SetSheet {...propsFor(makeSet(true), { onDelete: () => deleted.push("stale") })} />);
		click(screen.getByRole("button", { name: "Delete set" }));

		const confirmation = screen.getByRole("dialog", { name: "Delete completed set?" });
		const confirm = within(confirmation).getByRole("button", { name: "Delete set" });

		render(
			<SetSheet {...propsFor(makeSet(false), { onDelete: () => deleted.push("not-included") })} />,
		);
		expect(confirm.hasAttribute("disabled")).toBe(true);
		click(confirm);
		expect(deleted).toEqual([]);

		render(
			<SetSheet
				{...propsFor(makeSet(true, "replacement-set"), {
					onDelete: () => deleted.push("replacement"),
				})}
			/>,
		);
		expect(confirm.hasAttribute("disabled")).toBe(true);

		render(
			<SetSheet
				{...propsFor(makeSet(true), { disabled: true, onDelete: () => deleted.push("disabled") })}
			/>,
		);
		expect(confirm.hasAttribute("disabled")).toBe(true);
		click(confirm);
		expect(deleted).toEqual([]);

		render(<SetSheet {...propsFor(makeSet(true), { onDelete: () => deleted.push("current") })} />);
		expect(confirm.hasAttribute("disabled")).toBe(false);
		click(confirm);

		expect(deleted).toEqual(["current"]);
	});
});
