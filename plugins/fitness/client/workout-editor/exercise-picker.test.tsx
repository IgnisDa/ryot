import { afterEach, describe, expect, it } from "@effect/vitest";
import { EntityId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { WorkoutExercisePickerResult } from "../../shared/workout-exercise-recipes";
import { ExercisePicker } from "./exercise-picker";

type PickerExercise = WorkoutExercisePickerResult["items"][number];

const rows = (
	items: readonly Record<string, unknown>[],
	pageInfo: { readonly hasMore?: boolean; readonly nextCursor?: string | null } = {},
) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null, ...pageInfo },
});

const exercise = (id: string, name: string, kind: string) => ({
	id,
	name,
	kind,
	images: null,
	videos: null,
	targets: rows([]),
	instructions: null,
	equipment: rows([]),
	membershipProperties: null,
});

const pageContext = () => ({
	...savedViewPageContext({
		settings: {},
		dataSources: { queries: {} },
		savedViewId: "workout-exercise-picker",
		rendererName: "workout-exercise-picker",
		view: { icon: "dumbbell", name: "Workout exercise picker" },
	}),
	contributors: [
		pluginContributor({ name: "Fitness", pluginId: "fitness-owner", packageId: PLUGIN_PACKAGE_ID }),
	],
});

function PickerProbe(props: {
	readonly replacement?: { readonly name: string; readonly kind: "reps" | "duration" };
	readonly onApply: (exercises: readonly PickerExercise[]) => void;
}) {
	const [open, setOpen] = useState(true);
	return open ? (
		<ExercisePicker
			{...(props.replacement === undefined ? {} : { replacement: props.replacement })}
			onApply={props.onApply}
			onClose={() => setOpen(false)}
		/>
	) : (
		<p>Picker closed</p>
	);
}

const createPage = (props: {
	readonly onApply: (exercises: readonly PickerExercise[]) => void;
	readonly replacement?: { readonly name: string; readonly kind: "reps" | "duration" };
}) =>
	mountPluginPage(() => <PickerProbe {...props} />, {
		page: pageContext(),
		location: routeLocation("/workout-editor"),
	});

const orderedExercisePage = (index: number, after: string | undefined) => {
	if (after === "cursor-1") {
		return rows([exercise("exercise-2", "Deadlift", "reps_and_weight")]);
	}
	if (index >= 2) {
		return rows([exercise("exercise-3", "Cable row", "reps")]);
	}
	return rows([exercise("exercise-1", "Bench press", "reps_and_weight")], {
		hasMore: true,
		nextCursor: "cursor-1",
	});
};

const createRequestAnswerer = () => {
	const answeredStorage = new Set<string>();
	const answeredQueries = new Set<string>();
	let pickerExercisePageIndex = 0;
	return (
		page: ReturnType<typeof mountPluginPage>,
		options: {
			readonly exercisePage: (
				pageIndex: number,
				after: string | undefined,
			) => ReturnType<typeof rows>;
			readonly editorExercisePage?: () => ReturnType<typeof rows>;
			readonly storedPresets?: JsonValue;
		},
	) => {
		type QuerySuccess = Extract<
			Parameters<typeof page.replyQuery>[1],
			{ readonly outcome: "success" }
		>;
		type QueryData = QuerySuccess["response"]["data"];
		for (const request of page.clientMessages()) {
			if (
				request.type !== "storage-request" ||
				request.action !== "get" ||
				answeredStorage.has(request.requestId)
			) {
				continue;
			}
			answeredStorage.add(request.requestId);
			page.send({
				outcome: "success",
				type: "storage-result",
				requestId: request.requestId,
				value: options.storedPresets ?? null,
			});
		}
		for (const request of page.queryRequests()) {
			if (answeredQueries.has(request.requestId)) {
				continue;
			}
			answeredQueries.add(request.requestId);
			const data: Record<string, QueryData[string]> = {};
			for (const key of Object.keys(request.document.queries)) {
				const query = request.document.queries[key];
				if (key === "exercises" && query?.output.type === "rows") {
					const fields = query.output.fields.flatMap((field) =>
						"key" in field ? [field.key] : [],
					);
					if (fields.includes("properties")) {
						data.exercises = options.editorExercisePage?.() ?? rows([]);
					} else {
						data.exercises = options.exercisePage(
							pickerExercisePageIndex++,
							query.output.pagination.after,
						);
					}
				} else if (key === "membership") {
					data[key] = rows([]);
				} else {
					data[key] = rows([]);
				}
			}
			page.replyQuery(request.requestId, { outcome: "success", response: { data } });
		}
	};
};

const click = (element: Element) =>
	act(() => {
		fireEvent.click(element);
	});

const change = (element: Element, value: string) =>
	act(() => {
		fireEvent.change(element, { target: { value } });
	});

const providerRequest = (page: ReturnType<typeof mountPluginPage>) =>
	page.clientMessages().find((message) => message.type === "provider-search-screen");

const requireProviderRequest = (page: ReturnType<typeof mountPluginPage>) => {
	const request = providerRequest(page);
	if (request === undefined) {
		throw new Error("Expected a provider search request");
	}
	return request;
};

const pickerExerciseQueryCount = (page: ReturnType<typeof mountPluginPage>) =>
	page.queryRequests("exercises").filter((request) => {
		const query = request.document.queries.exercises;
		return (
			query?.output.type === "rows" &&
			!query.output.fields.some((field) => "key" in field && field.key === "properties")
		);
	}).length;

const replyProviderSearch = (
	page: ReturnType<typeof mountPluginPage>,
	requestId: string,
	outcome:
		| { readonly kind: "cancelled" }
		| { readonly kind: "added"; readonly entityIds: readonly EntityId[] },
) =>
	act(() => {
		page.send({
			requestId,
			value: outcome,
			outcome: "success",
			type: "provider-search-screen-result",
		});
	});

afterEach(() => {
	disposePluginBridges();
});

describe("ExercisePicker", () => {
	it.live("keeps selection order across pages and searches, then applies once", () =>
		Effect.gen(function* () {
			const applied: Array<readonly PickerExercise[]> = [];
			const page = createPage({ onApply: (items) => applied.push(items) });
			const answerRequests = createRequestAnswerer();
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, { exercisePage: orderedExercisePage });
					expect(screen.getByRole("checkbox", { name: "Bench press" })).toBeTruthy();
				}),
			);

			click(screen.getByRole("checkbox", { name: "Bench press" }));
			click(screen.getByRole("button", { name: "Show more" }));
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, { exercisePage: orderedExercisePage });
					expect(screen.getByRole("checkbox", { name: "Deadlift" })).toBeTruthy();
				}),
			);
			click(screen.getByRole("checkbox", { name: "Deadlift" }));
			change(screen.getByRole("searchbox", { name: "Search exercises" }), "Cable");
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, { exercisePage: orderedExercisePage });
					expect(screen.getByRole("checkbox", { name: "Cable row" })).toBeTruthy();
				}),
			);
			click(screen.getByRole("button", { name: "Add 2 exercises" }));

			expect(applied).toHaveLength(1);
			expect(applied[0]?.map(({ id }) => id)).toEqual(["exercise-1", "exercise-2"]);
			expect(screen.getByText("Picker closed")).toBeTruthy();
		}),
	);

	it.live("cancel closes without applying the local selection", () =>
		Effect.gen(function* () {
			const applied: Array<readonly PickerExercise[]> = [];
			const page = createPage({ onApply: (items) => applied.push(items) });
			const answerRequests = createRequestAnswerer();
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, {
						exercisePage: () => rows([exercise("exercise-1", "Bench press", "reps")]),
					});
					expect(screen.getByRole("checkbox", { name: "Bench press" })).toBeTruthy();
				}),
			);
			click(screen.getByRole("checkbox", { name: "Bench press" }));
			click(
				within(screen.getByRole("dialog", { name: "Add exercises" })).getByRole("button", {
					name: "Cancel exercise selection",
				}),
			);

			expect(applied).toHaveLength(0);
			expect(screen.getByText("Picker closed")).toBeTruthy();
		}),
	);

	it.live("retains a library selection when provider search is cancelled", () =>
		Effect.gen(function* () {
			const applied: Array<readonly PickerExercise[]> = [];
			const page = createPage({ onApply: (items) => applied.push(items) });
			const answerRequests = createRequestAnswerer();
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, {
						exercisePage: () => rows([exercise("exercise-1", "Bench press", "reps")]),
					});
					expect(screen.getByRole("checkbox", { name: "Bench press" })).toBeTruthy();
				}),
			);

			click(screen.getByRole("checkbox", { name: "Bench press" }));
			click(screen.getByRole("button", { name: "Add from provider" }));
			const request = yield* Effect.promise(() =>
				waitFor(() => {
					const current = requireProviderRequest(page);
					expect(current.type).toBe("provider-search-screen");
					return current;
				}),
			);
			replyProviderSearch(page, request.requestId, { kind: "cancelled" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Add from provider" })).toBeTruthy(),
				),
			);

			expect(screen.getByRole("button", { name: "Remove Bench press" })).toBeTruthy();
			expect(applied).toHaveLength(0);
			click(screen.getByRole("button", { name: "Add 1 exercise" }));
			expect(applied[0]?.map(({ id }) => id)).toEqual(["exercise-1"]);
		}),
	);

	it.live("reloads and checks a provider addition hidden by the active search", () =>
		Effect.gen(function* () {
			const applied: Array<readonly PickerExercise[]> = [];
			const page = createPage({ onApply: (items) => applied.push(items) });
			const answerRequests = createRequestAnswerer();
			const added = exercise("exercise-added", "Newly added exercise", "reps");
			const pickerPage = (index: number) => rows(index === 2 ? [added] : []);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, { exercisePage: (index) => pickerPage(index) });
					expect(screen.getByText("No exercises match these filters")).toBeTruthy();
				}),
			);

			change(screen.getByRole("searchbox", { name: "Search exercises" }), "hidden by search");
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, { exercisePage: (index) => pickerPage(index) });
					expect(pickerExerciseQueryCount(page)).toBe(2);
					expect(screen.getByText("No exercises match “hidden by search”")).toBeTruthy();
				}),
			);
			click(screen.getByRole("button", { name: "Add from provider" }));
			const request = yield* Effect.promise(() =>
				waitFor(() => {
					const current = requireProviderRequest(page);
					expect(current.type).toBe("provider-search-screen");
					return current;
				}),
			);
			expect(request.schema).toEqual({
				slug: "exercise",
				owner: { kind: "plugin", pluginId: "fitness-owner" },
			});
			expect(request.initialQuery).toBe("hidden by search");
			replyProviderSearch(page, request.requestId, {
				kind: "added",
				entityIds: [EntityId.make("exercise-added")],
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, {
						exercisePage: (index) => pickerPage(index),
						editorExercisePage: () =>
							rows([
								{
									id: "exercise-added",
									name: "Newly added exercise",
									properties: { kind: "reps" },
								},
							]),
					});
					expect(pickerExerciseQueryCount(page)).toBe(4);
					expect(screen.getByRole("button", { name: "Remove Newly added exercise" })).toBeTruthy();
					expect(screen.getByRole("button", { name: "Add from provider" })).toBeTruthy();
				}),
			);

			expect(page.queryRequests("exercises")).toHaveLength(5);
			expect(screen.queryByRole("checkbox", { name: "Newly added exercise" })).toBeNull();
			expect(applied).toHaveLength(0);
			click(screen.getByRole("button", { name: "Add 1 exercise" }));
			expect(applied[0]?.map(({ id }) => id)).toEqual(["exercise-added"]);
		}),
	);

	it.live("does not select an incompatible provider addition during replacement", () =>
		Effect.gen(function* () {
			const applied: Array<readonly PickerExercise[]> = [];
			const page = createPage({
				onApply: (items) => applied.push(items),
				replacement: { kind: "duration", name: "Current exercise" },
			});
			const answerRequests = createRequestAnswerer();
			const duration = exercise("exercise-duration", "Timed exercise", "duration");
			const providerReps = exercise("exercise-reps", "Rep exercise", "reps");
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, {
						exercisePage: (index) => rows(index === 1 ? [providerReps] : [duration]),
					});
					expect(screen.getByRole("radio", { name: "Timed exercise" })).toBeTruthy();
				}),
			);

			click(screen.getByRole("radio", { name: "Timed exercise" }));
			click(screen.getByRole("button", { name: "Add from provider" }));
			const request = yield* Effect.promise(() =>
				waitFor(() => {
					const current = requireProviderRequest(page);
					expect(current.type).toBe("provider-search-screen");
					return current;
				}),
			);
			replyProviderSearch(page, request.requestId, {
				kind: "added",
				entityIds: [EntityId.make("exercise-reps")],
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, {
						exercisePage: (index) => rows(index === 1 ? [providerReps] : [duration]),
						editorExercisePage: () =>
							rows([{ id: "exercise-reps", name: "Rep exercise", properties: { kind: "reps" } }]),
					});
					expect(
						screen.getByText(
							"The exercise was added to your library, but its kind is not eligible for this selection.",
						),
					).toBeTruthy();
					expect(screen.getByRole("button", { name: "Add from provider" })).toBeTruthy();
				}),
			);

			expect(screen.getByRole("button", { name: "Remove Timed exercise" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Remove Rep exercise" })).toBeNull();
			expect(applied).toHaveLength(0);
			click(screen.getByRole("button", { name: "Replace exercise" }));
			expect(applied[0]?.map(({ id }) => id)).toEqual(["exercise-duration"]);
		}),
	);

	it.live("replacement mode fixes the kind and only applies one matching exercise", () =>
		Effect.gen(function* () {
			const applied: Array<readonly PickerExercise[]> = [];
			const answerRequests = createRequestAnswerer();
			const page = createPage({
				onApply: (items) => applied.push(items),
				replacement: { kind: "duration", name: "Current exercise" },
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, {
						exercisePage: () =>
							rows([
								exercise("exercise-reps", "Rep exercise", "reps"),
								exercise("exercise-duration", "Timed exercise", "duration"),
							]),
					});
					expect(screen.getByRole("radio", { name: "Timed exercise" })).toBeTruthy();
				}),
			);

			expect(screen.getByRole("heading", { name: "Replace Current exercise" })).toBeTruthy();
			expect(screen.getByRole("radio", { name: "Rep exercise" }).hasAttribute("disabled")).toBe(
				true,
			);
			click(screen.getByRole("radio", { name: "Timed exercise" }));
			click(screen.getByRole("button", { name: "Replace exercise" }));

			expect(applied[0]?.map(({ id }) => id)).toEqual(["exercise-duration"]);
		}),
	);

	it.live("does not overwrite malformed saved presets and offers a read retry", () =>
		Effect.gen(function* () {
			const page = createPage({ onApply: () => undefined });
			const answerRequests = createRequestAnswerer();
			yield* Effect.promise(() =>
				waitFor(() => {
					answerRequests(page, {
						exercisePage: () => rows([]),
						storedPresets: { malformed: true },
					});
					expect(
						screen.getByText("Saved presets could not be read or decoded. They were not changed."),
					).toBeTruthy();
				}),
			);

			click(screen.getByRole("button", { name: "Presets" }));
			expect(
				screen.getByRole("menuitem", { name: "Save current filters…" }).hasAttribute("disabled"),
			).toBe(true);
			expect(
				page
					.clientMessages()
					.filter((message) => message.type === "storage-request" && message.action === "set"),
			).toHaveLength(0);
		}),
	);
});
