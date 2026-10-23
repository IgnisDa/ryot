import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { disposePluginBridges } from "@ryot-app/plugin-client-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act, useEffect, useState } from "react";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { mountDialogInPluginPage } from "../../tests/client/plugin-page";
import { SetSheet } from "./set-sheet";

afterEach(disposePluginBridges);

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
		disabled: false,
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

type SheetProps = Parameters<typeof SetSheet>[0];

const mountSheet = (initial: SheetProps) => {
	let update: ((props: SheetProps) => void) | undefined;
	function Probe() {
		const [props, setProps] = useState(initial);
		useEffect(() => {
			update = setProps;
		}, []);
		return <SetSheet {...props} />;
	}
	return Effect.map(
		mountDialogInPluginPage(() => <Probe />),
		() => (props: SheetProps) => act(() => update?.(props)),
	);
};

describe("SetSheet", () => {
	it.live("deletes incomplete sets directly", () =>
		Effect.gen(function* () {
			const deleted: string[] = [];
			yield* mountSheet(propsFor(makeSet(false), { onDelete: () => deleted.push("set") }));

			click(screen.getByRole("button", { name: "Delete set" }));

			expect(deleted).toEqual(["set"]);
			expect(screen.queryByRole("dialog", { name: "Delete completed set?" })).toBeNull();
		}),
	);

	it.live("asks before deleting a completed set and cancel changes nothing", () =>
		Effect.gen(function* () {
			const deleted: string[] = [];
			yield* mountSheet(propsFor(makeSet(true), { onDelete: () => deleted.push("set") }));

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

	it.live(
		"confirms only for the current completed set while enabled and uses the latest callback",
		() =>
			Effect.gen(function* () {
				const deleted: string[] = [];
				const render = yield* mountSheet(
					propsFor(makeSet(true), { onDelete: () => deleted.push("stale") }),
				);
				click(screen.getByRole("button", { name: "Delete set" }));

				const confirmation = screen.getByRole("dialog", { name: "Delete completed set?" });
				const confirm = within(confirmation).getByRole("button", { name: "Delete set" });

				render(propsFor(makeSet(false), { onDelete: () => deleted.push("not-included") }));
				expect(confirm.hasAttribute("disabled")).toBe(true);
				click(confirm);
				expect(deleted).toEqual([]);

				render(
					propsFor(makeSet(true, "replacement-set"), {
						onDelete: () => deleted.push("replacement"),
					}),
				);
				expect(confirm.hasAttribute("disabled")).toBe(true);

				render(
					propsFor(makeSet(true), { disabled: true, onDelete: () => deleted.push("disabled") }),
				);
				expect(confirm.hasAttribute("disabled")).toBe(true);
				click(confirm);
				expect(deleted).toEqual([]);

				render(propsFor(makeSet(true), { onDelete: () => deleted.push("current") }));
				expect(confirm.hasAttribute("disabled")).toBe(false);
				click(confirm);

				expect(deleted).toEqual(["current"]);
			}),
	);
});
