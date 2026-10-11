import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { exerciseOverrideUpdateOperationSlug } from "../../shared/workout-editor-context-operations";
import {
	emptyTotals,
	exerciseDetails,
	exerciseRecord,
	storedEditorDraft,
} from "../../tests/client/exercise-fixtures";
import { ExerciseDetailsView } from "./screen";

afterEach(disposePluginBridges);

const pluginId = PluginId.make("fitness-owner");
const pageContext: ClientPageContext = {
	view: null,
	settings: {},
	dataSources: null,
	route: { params: {} },
	renderer: { pluginId, kind: "plugin", exportName: "exercise-detail" },
	target: { path: "/", search: "", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
	contributors: [pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID })],
};

const renderDetails = (details: ReturnType<typeof exerciseDetails>, storedDraft: string | null) => {
	const page = mountPluginPage(
		() => (
			<ExerciseDetailsView
				timeZone="UTC"
				compact={false}
				details={details}
				onChanged={() => undefined}
				now={new Date("2026-10-12T00:00:00.000Z")}
				exercise={details.exercise ?? exerciseRecord()}
			/>
		),
		{
			page: pageContext,
			location: routeLocation("/"),
			onClientMessage: (message) => {
				if (message.type === "storage-request" && message.action === "get") {
					page.send({
						value: storedDraft,
						outcome: "success",
						type: "storage-result",
						requestId: message.requestId,
					});
				}
			},
		},
	);
	return page;
};

const mountedPage = (details: ReturnType<typeof exerciseDetails>, storedDraft: string | null) =>
	Effect.gen(function* () {
		const page = renderDetails(details, storedDraft);
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(page.container?.querySelector("h1")?.textContent).toBe(details.exercise?.name),
			),
		);
		return page;
	});

const mounted = (details: ReturnType<typeof exerciseDetails>, storedDraft: string | null = null) =>
	mountedPage(details, storedDraft).pipe(Effect.map((page) => page.container));

const click = (element: Element) =>
	act(() => {
		fireEvent.click(element);
	});

const openMenu = () => click(screen.getByRole("button", { name: "More exercise actions" }));

const navigations = (page: ReturnType<typeof renderDetails>) =>
	Effect.promise(() =>
		waitFor(() => {
			const sent = page.clientMessages().filter((message) => message.type === "navigate");
			expect(sent).toHaveLength(1);
			return sent;
		}),
	);

const performedTotals = {
	...emptyTotals,
	sets: 4,
	reps: 40,
	sessions: 2,
	volume: 3200,
	warmUpSets: 1,
	failureSets: 1,
	weightForReps5: 80,
	weightForReps1: 100,
	lastAt: "2026-10-05T10:00:00.000Z",
	firstAt: "2026-01-05T10:00:00.000Z",
};

const draftWith = (mode: Record<string, unknown>, exerciseId: string) =>
	storedEditorDraft({
		mode,
		occurrences: [
			{
				sets: [],
				notes: [],
				exerciseId,
				images: [],
				videos: [],
				isCollapsed: false,
				clientId: "occurrence-1",
				exerciseKind: "reps_and_weight",
				display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
			},
		],
	});

describe("exercise details view", () => {
	it.live("shows history, sessions, personal bests and notes for a performed weight exercise", () =>
		Effect.gen(function* () {
			const container = yield* mounted(
				exerciseDetails({
					totals: performedTotals,
					exercise: exerciseRecord({
						instructions: ["Lie back on the bench."],
						targets: [
							{ name: "Chest", role: "primary" },
							{ name: "Triceps", role: "secondary" },
						],
					}),
					months: [
						{
							reps: 20,
							sessions: 1,
							maxReps: 10,
							volume: 1600,
							maxOneRm: 93,
							maxPace: null,
							maxWeight: 80,
							duration: null,
							distance: null,
							maxDuration: null,
							month: "2026-10-01T00:00:00.000Z",
						},
					],
					notes: [
						{
							rating: 80,
							id: "note-1",
							updatedAt: "2026-10-05T10:00:00.000Z",
							occurredAt: "2026-10-05T10:00:00.000Z",
							text: "Keep elbows tucked.\nBreathe out.",
						},
						{
							text: null,
							id: "note-2",
							rating: null,
							updatedAt: "2026-10-04T10:00:00.000Z",
							occurredAt: "2026-10-04T10:00:00.000Z",
						},
					],
					sessions: [
						{
							endedAt: null,
							id: "workout-1",
							name: "Push day",
							startedAt: "2026-10-05T09:00:00.000Z",
							sets: {
								pageInfo: { limit: 100, hasMore: false },
								items: [
									{
										id: "s1",
										reps: 10,
										weight: 40,
										setOrder: 0,
										duration: null,
										distance: null,
										setLot: "warm_up",
									},
									{
										reps: 3,
										id: "s2",
										weight: 80,
										setOrder: 1,
										duration: null,
										distance: null,
										setLot: "failure",
									},
								],
							},
						},
					],
				}),
			);
			const text = container?.textContent ?? "";

			expect(text).toContain("Your history");
			expect(text).toContain("Best weight by rep count");
			expect(text).toContain("Push day");
			expect(text).toContain("Primary");
			expect(text).toContain("Secondary");
			expect(text).toContain("Empty note");
			expect(container?.querySelector("header")?.textContent).not.toContain("Edit");
			expect(container?.querySelector('[data-set-lot="warm_up"]')?.textContent).toContain(
				"Warm-up",
			);
			expect(container?.querySelector('[data-set-lot="failure"]')?.textContent).toContain("Fail");
			expect(container?.querySelector('[aria-label="Rated 4 of 5"]')).not.toBeNull();
			expect(container?.querySelector("p.whitespace-pre-wrap")?.textContent).toBe(
				"Keep elbows tucked.\nBreathe out.",
			);
		}),
	);

	it.live("puts instructions before an empty history card when never performed", () =>
		Effect.gen(function* () {
			const container = yield* mounted(
				exerciseDetails({ exercise: exerciseRecord({ instructions: ["Hold the kettlebell."] }) }),
			);
			const text = container?.textContent ?? "";

			expect(text).toContain("You haven't logged this exercise yet.");
			expect(text.indexOf("How to perform")).toBeLessThan(text.indexOf("Your history"));
			expect(text).not.toContain("Recent sessions");
			expect(text).not.toContain("Best weight by rep count");
		}),
	);

	it.live("offers Edit and the empty states only for a custom exercise", () =>
		Effect.gen(function* () {
			const custom = yield* mounted(
				exerciseDetails({ exercise: exerciseRecord({ userId: "user-1", kind: "duration" }) }),
			);
			const customText = custom?.textContent ?? "";

			expect(custom?.querySelector("header")?.textContent).toContain("Edit");
			expect(customText).toContain("No muscles tagged yet.");
			expect(customText).toContain("You haven't written instructions");

			const provider = yield* mounted(exerciseDetails());
			expect(provider?.querySelector("header")?.textContent).not.toContain("Edit");
			expect(provider?.textContent).not.toContain("No muscles tagged yet.");
		}),
	);

	it.live("renders roleless targets as one group", () =>
		Effect.gen(function* () {
			const container = yield* mounted(
				exerciseDetails({
					exercise: exerciseRecord({
						targets: [
							{ role: null, name: "Lats" },
							{ role: null, name: "Biceps" },
						],
					}),
				}),
			);
			const text = container?.textContent ?? "";

			expect(text).toContain("Lats");
			expect(text).toContain("Biceps");
			expect(text).not.toContain("Primary");
			expect(text).not.toContain("Secondary");
		}),
	);

	it.live("offers no add-to-draft button without an active draft", () =>
		Effect.gen(function* () {
			yield* mounted(exerciseDetails());
			yield* Effect.sleep("20 millis");
			expect(screen.queryByRole("button", { name: /^Add to (current|workout)/ })).toBeNull();
			expect(screen.getByRole("button", { name: "Add to collection" })).toBeTruthy();
		}),
	);

	it.live("labels the add button by the active draft mode and ignores finished drafts", () =>
		Effect.gen(function* () {
			const labelled = [
				[{}, "Add to current workout"],
				[{ mode: { kind: "template-create" } }, "Add to current template"],
				[
					{ mode: { kind: "historical", entityId: "workout-1", conflictToken: "token" } },
					"Add to workout",
				],
			] as const;
			for (const [overrides, label] of labelled) {
				yield* mounted(exerciseDetails(), storedEditorDraft(overrides));
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("button", { name: label })).toBeTruthy()),
				);
				disposePluginBridges();
			}
			yield* mounted(exerciseDetails(), storedEditorDraft({ endedAt: "2026-10-12T10:00:00.000Z" }));
			yield* Effect.sleep("20 millis");
			expect(screen.queryByRole("button", { name: /^Add to (current|workout)/ })).toBeNull();
		}),
	);

	it.live("sends the exercise to the editor through the add parameter", () =>
		Effect.gen(function* () {
			const page = yield* mountedPage(exerciseDetails(), storedEditorDraft());
			yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("button", { name: "Add to current workout" })),
			);
			click(screen.getByRole("button", { name: "Add to current workout" }));
			expect(yield* navigations(page)).toEqual([
				expect.objectContaining({
					mode: "push",
					target: expect.objectContaining({ path: "/workout-editor", search: "add=exercise-1" }),
				}),
			]);
		}),
	);

	it.live("offers Edit only for custom exercises and navigates to the edit route", () =>
		Effect.gen(function* () {
			const page = yield* mountedPage(
				exerciseDetails({ exercise: exerciseRecord({ id: "custom 1", userId: "user-1" }) }),
				null,
			);
			click(screen.getByRole("button", { name: "Edit" }));
			expect(yield* navigations(page)).toEqual([
				expect.objectContaining({
					target: expect.objectContaining({ path: "/exercises/custom%201/edit" }),
				}),
			]);
		}),
	);

	it.live("lists merge only for custom exercises and duplicates from the menu", () =>
		Effect.gen(function* () {
			for (const userId of [null, "user-1"]) {
				const page = yield* mountedPage(
					exerciseDetails({ exercise: exerciseRecord({ userId }) }),
					null,
				);
				openMenu();
				expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
					"Preferences",
					"Post a review",
					"Duplicate",
					...(userId === null ? [] : ["Merge into…"]),
				]);
				click(screen.getByRole("menuitem", { name: "Duplicate" }));
				expect(yield* navigations(page)).toEqual([
					expect.objectContaining({
						target: expect.objectContaining({
							path: "/exercises/new",
							search: "duplicate=exercise-1",
						}),
					}),
				]);
				disposePluginBridges();
			}
		}),
	);

	it.live("focuses the note composer for Post a review", () =>
		Effect.gen(function* () {
			yield* mounted(exerciseDetails());
			openMenu();
			click(screen.getByRole("menuitem", { name: "Post a review" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("New note"))),
			);
		}),
	);

	it.live("opens the collection picker from the header", () =>
		Effect.gen(function* () {
			yield* mounted(exerciseDetails());
			click(screen.getByRole("button", { name: "Add to collection" }));
			expect(screen.getByRole("dialog", { name: "Add to collection" })).toBeTruthy();
		}),
	);

	it.live("saves exercise preferences with the duration unit only for duration kinds", () =>
		Effect.gen(function* () {
			yield* mounted(exerciseDetails());
			openMenu();
			click(screen.getByRole("menuitem", { name: "Preferences" }));
			const weightDialog = screen.getByRole("dialog", { name: "Exercise preferences" });
			expect(within(weightDialog).queryByText("Default duration unit")).toBeNull();
			disposePluginBridges();

			const page = yield* mountedPage(
				exerciseDetails({
					exercise: exerciseRecord({
						kind: "duration",
						membershipProperties: { normalRestTime: 30 },
					}),
				}),
				null,
			);
			openMenu();
			click(screen.getByRole("menuitem", { name: "Preferences" }));
			const dialog = screen.getByRole("dialog", { name: "Exercise preferences" });
			expect(within(dialog).getByText("Default duration unit")).toBeTruthy();
			click(within(dialog).getByRole("button", { name: "Save defaults" }));
			const request = yield* Effect.promise(() =>
				waitFor(() => {
					const operation = page
						.clientMessages()
						.find((message) => message.type === "operation-request");
					assert(operation?.type === "operation-request");
					return operation;
				}),
			);
			expect(request.operationSlug).toBe(exerciseOverrideUpdateOperationSlug);
			expect(request.input).toEqual({
				exerciseId: "exercise-1",
				set: { normalRestTime: 30 },
				remove: ["dropRestTime", "warmUpRestTime", "failureRestTime", "defaultDurationUnit"],
			});
		}),
	);

	it.live("disables merge with the reason when the active draft contains the exercise", () =>
		Effect.gen(function* () {
			const custom = exerciseDetails({ exercise: exerciseRecord({ userId: "user-1" }) });
			for (const [mode, addLabel, reason] of [
				[
					{ kind: "live" },
					"Add to current workout",
					"Not available while this exercise is in your current workout",
				],
				[
					{ kind: "template-create" },
					"Add to current template",
					"Not available while this exercise is in your current template",
				],
			] as const) {
				yield* mounted(custom, draftWith(mode, "exercise-1"));
				yield* Effect.promise(() => waitFor(() => screen.getByRole("button", { name: addLabel })));
				openMenu();
				const item = screen.getByRole("menuitem", { name: `Merge into… (${reason})` });
				expect(item.hasAttribute("disabled")).toBe(true);
				disposePluginBridges();
			}

			yield* mounted(custom, draftWith({ kind: "live" }, "another-exercise"));
			yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("button", { name: "Add to current workout" })),
			);
			openMenu();
			expect(screen.getByRole("menuitem", { name: "Merge into…" }).hasAttribute("disabled")).toBe(
				false,
			);
		}),
	);
});

const pickerRows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const pickerExercise = (id: string, name: string) => ({
	id,
	name,
	images: null,
	videos: null,
	instructions: null,
	kind: "reps_and_weight",
	targets: pickerRows([]),
	equipment: pickerRows([]),
	membershipProperties: null,
});

const mountCustomExercise = () => {
	const exercise = exerciseRecord({ id: "custom-1", userId: "user-1", name: "My press" });
	const answered = new Set<string>();
	const page = mountPluginPage(
		() => (
			<ExerciseDetailsView
				timeZone="UTC"
				compact={false}
				exercise={exercise}
				onChanged={() => undefined}
				details={exerciseDetails({ exercise })}
				now={new Date("2026-10-12T00:00:00.000Z")}
			/>
		),
		{
			page: pageContext,
			location: routeLocation("/"),
			onClientMessage: (message) => {
				if (message.type === "storage-request" && message.action === "get") {
					page.send({
						value: null,
						outcome: "success",
						type: "storage-result",
						requestId: message.requestId,
					});
				}
			},
		},
	);
	const answerQueries = () => {
		for (const request of page.queryRequests()) {
			if (!answered.has(request.requestId)) {
				answered.add(request.requestId);
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: {
						data: Object.fromEntries(
							Object.keys(request.document.queries).map((key) => [
								key,
								pickerRows(
									key === "exercises"
										? [
												pickerExercise("custom-1", "My press"),
												pickerExercise("global-1", "Bench press"),
											]
										: [],
								),
							]),
						),
					},
				});
			}
		}
	};
	return { page, answerQueries };
};

const confirmMerge = (setup: ReturnType<typeof mountCustomExercise>) =>
	Effect.gen(function* () {
		yield* Effect.promise(() => waitFor(() => screen.getByRole("heading", { name: "My press" })));
		openMenu();
		click(screen.getByRole("menuitem", { name: "Merge into…" }));
		yield* Effect.promise(() =>
			waitFor(() => {
				setup.answerQueries();
				expect(screen.getByRole("radio", { name: "Bench press" })).toBeTruthy();
			}),
		);
		expect(screen.queryByRole("radio", { name: "My press" })).toBeNull();
		click(screen.getByRole("radio", { name: "Bench press" }));
		click(screen.getByRole("button", { name: "Merge into" }));
		const dialog = yield* Effect.promise(() =>
			waitFor(() => screen.getByRole("dialog", { name: "Merge exercise?" })),
		);
		expect(dialog.textContent).toContain(
			"Merge My press into Bench press? Its history, notes and collection memberships move to Bench press. My press is removed from your library.",
		);
		click(within(dialog).getByRole("button", { name: "Merge" }));
		const request = yield* Effect.promise(() =>
			waitFor(() => {
				const operation = setup.page
					.clientMessages()
					.find((message) => message.type === "operation-request");
				assert(operation?.type === "operation-request");
				return operation;
			}),
		);
		expect(request.operationSlug).toBe("exercise-merge");
		expect(request.input).toEqual({ mergeFrom: "custom-1", mergeInto: "global-1" });
		return request;
	});

describe("exercise merge", () => {
	it.live("merges into the chosen exercise and opens the target", () =>
		Effect.gen(function* () {
			const setup = mountCustomExercise();
			const request = yield* confirmMerge(setup);
			act(() => {
				setup.page.send({
					outcome: "success",
					type: "operation-result",
					requestId: request.requestId,
					value: { kind: "merged", mergeInto: "global-1" },
				});
			});
			expect(yield* navigations(setup.page)).toEqual([
				expect.objectContaining({
					mode: "replace",
					target: expect.objectContaining({ kind: "entity", entityId: "global-1" }),
				}),
			]);
		}),
	);

	it.live("shows a status message and stays on the exercise when the merge is refused", () =>
		Effect.gen(function* () {
			const setup = mountCustomExercise();
			const request = yield* confirmMerge(setup);
			act(() => {
				setup.page.send({
					outcome: "success",
					type: "operation-result",
					requestId: request.requestId,
					value: { kind: "kind-mismatch" },
				});
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.getByText("Exercises can only be merged into an exercise of the same kind."),
					).toBeTruthy(),
				),
			);
			expect(screen.queryByRole("dialog", { name: "Merge exercise?" })).toBeNull();
			expect(setup.page.clientMessages().some(({ type }) => type === "navigate")).toBe(false);
		}),
	);
});
