import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { waitFor, within } from "@testing-library/dom";
import type { ReactNode } from "react";

import type { ExerciseDetails } from "../../shared/exercise-details-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { WorkoutSummary } from "../../shared/workout-list-recipes";
import { emptyTotals, exerciseDetails, exerciseRecord } from "../../tests/client/exercise-fixtures";
import { workoutDetails, workoutExercise, workoutSet } from "../../tests/client/workout-fixtures";
import { HistorySection, RecentSessions } from "../exercise/history";
import { WorkoutProcessing } from "../workout-processing";
import { WorkoutSummarySection } from "../workouts/summary";
import { WorkoutDetailsView } from "./screen";

afterEach(disposePluginBridges);

const now = new Date("2026-10-12T12:00:00.000Z");

const mountProcessing = (children: ReactNode) => {
	const page = mountPluginPage(() => <WorkoutProcessing>{children}</WorkoutProcessing>, {
		location: routeLocation("/"),
		page: {
			...savedViewPageContext({
				settings: {},
				rendererName: "workouts",
				savedViewId: "all-workouts",
				dataSources: { queries: {} },
			}),
			contributors: [
				pluginContributor({
					name: "Fitness",
					pluginId: "fitness-owner",
					packageId: PLUGIN_PACKAGE_ID,
				}),
			],
		},
	});
	const answered = new Set<string>();
	const settle = (status: "ready" | "failed" | "pending", assertion: () => void) =>
		Effect.promise(() =>
			waitFor(() => {
				for (const request of page.queryRequests("processing")) {
					if (!answered.has(request.requestId)) {
						answered.add(request.requestId);
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: {
								data: {
									processing: {
										type: "aggregate",
										items: [
											{
												failed: status === "failed" ? 1 : 0,
												pending: status === "pending" ? 1 : 0,
											},
										],
									},
								},
							},
						});
					}
				}
				const text = document.body.textContent;
				expect(page.queryRequests("processing").length).toBeGreaterThan(0);
				if (status === "ready") {
					expect(text).not.toContain("Checking calculated results…");
					expect(text).not.toContain("Updating calculated results…");
				} else {
					expect(text).toContain(
						status === "failed"
							? "Calculated results could not be updated."
							: "Updating calculated results…",
					);
				}
				assertion();
			}),
		);
	return { page, settle };
};

const totals = {
	workouts: 2,
	volume: 1000,
	personalBests: 2,
	timedWorkouts: 2,
	activeDuration: 120,
};

const summary: WorkoutSummary = {
	current: totals,
	previous: { ...totals, volume: 500 },
	days: [{ ...totals, at: "2026-10-12T00:00:00.000Z" }],
	latestRecord: {
		reps: 10,
		weight: 100,
		duration: null,
		distance: null,
		exerciseName: "Recorded bench",
		exerciseKind: "reps_and_weight",
	},
};

const Summary = (props: { readonly value?: WorkoutSummary }) => (
	<WorkoutSummarySection
		now={now}
		period="7D"
		isError={false}
		imperial={false}
		onRetry={() => undefined}
		timeZone={TimeZone.make("UTC")}
		summary={props.value ?? summary}
		onPeriodChange={() => undefined}
	/>
);

const history = exerciseDetails({
	totals: { ...emptyTotals, sets: 2, reps: 15, sessions: 1, volume: 1000, weightForReps1: 100 },
	months: [
		{
			reps: 15,
			sessions: 1,
			maxReps: 10,
			volume: 1000,
			maxOneRm: 120,
			failedSets: 0,
			maxPace: null,
			maxWeight: 100,
			pendingSets: 0,
			duration: null,
			distance: null,
			maxDuration: null,
			month: "2026-10-01T00:00:00.000Z",
		},
	],
	sessions: [
		{
			endedAt: null,
			id: "session",
			name: "Recorded session",
			startedAt: "2026-10-12T10:00:00.000Z",
			sets: {
				pageInfo: { limit: 100, hasMore: false },
				items: [
					workoutSet({ reps: 10, weight: 100 }),
					workoutSet({ reps: 5, weight: 999, id: "reps-only", exerciseKind: "reps" }),
				],
			},
		},
	],
	personalBests: [
		{
			reps: 10,
			id: "best",
			oneRm: 120,
			weight: 100,
			volume: 1000,
			duration: null,
			distance: null,
			workoutId: "session",
			workoutName: "Recorded session",
			exerciseKind: "reps_and_weight",
			personalBests: ["one_rm", "volume"],
			occurredAt: "2026-10-12T10:00:00.000Z",
			workoutStartedAt: "2026-10-12T10:00:00.000Z",
		},
	],
});

const History = (props: { readonly value?: ExerciseDetails }) => {
	const details = props.value ?? history;
	return (
		<>
			<HistorySection
				now={now}
				compact={false}
				details={details}
				exercise={exerciseRecord()}
				timeZone={TimeZone.make("UTC")}
			/>
			<RecentSessions compact={false} details={details} />
		</>
	);
};

const recordedWorkout = (recordStatus: "ready" | "failed" | "pending" = "ready", volume = 1000) =>
	workoutDetails({
		caloriesBurnt: 0,
		activeDuration: 600,
		exercises: [
			workoutExercise({
				previousSets: [workoutSet({ volume: 500 })],
				previousWorkoutStartedAt: "2024-12-17T02:53:12.000Z",
				equipment: [{ id: "dumbbell", name: "Retained dumbbell" }],
				targets: [{ id: "biceps", role: "primary", name: "Retained biceps" }],
				sets: [
					workoutSet({
						volume,
						oneRm: 120,
						weight: 100,
						recordStatus,
						personalBests: ["volume"],
						confirmedAt: "2024-12-24T03:00:00.000Z",
					}),
				],
			}),
		],
	});

const Workout = (props: {
	readonly volume?: number;
	readonly imperial?: boolean;
	readonly recordStatus?: "ready" | "failed" | "pending";
}) => (
	<WorkoutDetailsView
		compact={false}
		proAvailable={false}
		workout={recordedWorkout(props.recordStatus, props.volume)}
		settings={{ energyUnit: "kcal", unitSystem: props.imperial ? "imperial" : "metric" }}
	/>
);

describe("calculated display readiness", () => {
	for (const status of ["pending", "failed"] as const) {
		it.live(
			`masks cached summary volume, awards and heatmap when processing becomes ${status}`,
			() =>
				Effect.gen(function* () {
					const { page, settle } = mountProcessing(<Summary />);
					const body = within(document.body);
					yield* settle("ready", () => {
						expect(body.getByRole("region", { name: "Summary" }).textContent).toContain(
							"1K kg × reps",
						);
						expect(body.getByText(/latest: Recorded bench/)).toBeTruthy();
						expect(body.getByRole("img", { name: /Training days/ })).toBeTruthy();
					});
					page.send({ type: "page-refresh" });
					yield* settle(status, () => {
						const text = body.getByRole("region", { name: "Summary" }).textContent;
						expect(text).toContain("Workouts2");
						expect(text).toContain("Recorded active duration2 min");
						expect(text).toContain("Calculated awards unavailable");
						expect(text).not.toContain("kg × reps");
						expect(text).not.toContain("Recorded bench");
						expect(text).not.toContain("▲");
						expect(body.queryByRole("img", { name: /Training days/ })).toBeNull();
					});
				}),
		);

		it.live(
			`masks cached exercise projections when processing becomes ${status}, keeping entered history`,
			() =>
				Effect.gen(function* () {
					const { page, settle } = mountProcessing(<History />);
					const body = within(document.body);
					yield* settle("ready", () => {
						expect(body.getAllByText("1,000 kg × reps")).toHaveLength(2);
						expect(body.getByRole("heading", { name: "Personal bests" })).toBeTruthy();
						expect(body.getByRole("img", { name: /Est. one-rep max.*120 kg/ })).toBeTruthy();
					});
					page.send({ type: "page-refresh" });
					yield* settle(status, () => {
						expect(document.body.textContent).toContain("Sessions1");
						expect(document.body.textContent).toContain("Sets2");
						expect(document.body.textContent).toContain("Total reps15");
						expect(body.getByText("100 kg × 10")).toBeTruthy();
						expect(body.getByText("5 reps")).toBeTruthy();
						expect(document.body.textContent).not.toContain("999");
						expect(document.body.textContent).not.toContain("kg × reps");
						expect(body.queryByRole("heading", { name: "Personal bests" })).toBeNull();
						expect(body.queryByRole("heading", { name: "Best weight by rep count" })).toBeNull();
						expect(body.queryByRole("img", { name: /Est. one-rep max/ })).toBeNull();
					});
				}),
		);

		it.live(`masks cached workout projections and taxonomy when processing becomes ${status}`, () =>
			Effect.gen(function* () {
				const { page, settle } = mountProcessing(<Workout />);
				const body = within(document.body);
				yield* settle("ready", () => {
					expect(document.body.textContent).toContain("1,000 kg × reps");
					expect(document.body.textContent).toContain("+500 kg × reps");
					expect(body.getByRole("heading", { name: "Muscles worked" })).toBeTruthy();
					expect(body.getByRole("columnheader", { name: "Est. 1RM" })).toBeTruthy();
				});
				page.send({ type: "page-refresh" });
				yield* settle(status, () => {
					const text = document.body.textContent;
					expect(text).toContain("Active duration10 min");
					expect(text).toContain("Sets1");
					expect(text).toContain("Energy0");
					expect(text).toContain("100 kg × 10");
					expect(text).toContain("Unknown");
					expect(text).not.toContain("kg × reps");
					expect(text).not.toContain("Personal-best awards");
					expect(text).not.toContain("Retained biceps");
					expect(text).not.toContain("Retained dumbbell");
					expect(body.queryByRole("columnheader", { name: "Est. 1RM" })).toBeNull();
					expect(body.queryByRole("heading", { name: "Muscles worked" })).toBeNull();
					expect(body.getByRole("heading", { name: "Session flow" })).toBeTruthy();
				});
			}),
		);
	}

	it.live("keeps incomplete summary aggregates masked while the processing poll is ready", () =>
		Effect.gen(function* () {
			const { settle } = mountProcessing(
				<Summary
					value={{
						...summary,
						latestRecord: null,
						current: { ...totals, volume: null, personalBests: null },
						days: [{ ...totals, volume: null, at: "2026-10-12T00:00:00.000Z" }],
					}}
				/>,
			);
			yield* settle("ready", () => {
				expect(document.body.textContent).toContain("Workouts2");
				expect(document.body.textContent).toContain("Calculated awards unavailable");
				expect(document.body.textContent).not.toContain("kg × reps");
				expect(within(document.body).queryByRole("img", { name: /Training days/ })).toBeNull();
			});
		}),
	);

	it.live("keeps incomplete exercise aggregates masked while the processing poll is ready", () =>
		Effect.gen(function* () {
			const { settle } = mountProcessing(
				<History
					value={{
						...history,
						totals: { ...history.totals, pendingSets: 1 },
						months: history.months.map((month) => Object.assign({}, month, { pendingSets: 1 })),
					}}
				/>,
			);
			yield* settle("ready", () => {
				const body = within(document.body);
				expect(document.body.textContent).toContain("Total reps15");
				expect(body.getByText("100 kg × 10")).toBeTruthy();
				expect(document.body.textContent).not.toContain("kg × reps");
				expect(body.queryByRole("heading", { name: "Personal bests" })).toBeNull();
				expect(body.queryByRole("heading", { name: "Best weight by rep count" })).toBeNull();
				expect(body.queryByRole("img", { name: /Est. one-rep max/ })).toBeNull();
			});
		}),
	);

	it.live("keeps pending workout rows masked while the processing poll is ready", () =>
		Effect.gen(function* () {
			const { settle } = mountProcessing(<Workout recordStatus="pending" />);
			yield* settle("ready", () => {
				const text = document.body.textContent;
				expect(text).toContain("Sets1");
				expect(text).toContain("100 kg × 10");
				expect(text).toContain("Updating records…");
				expect(text).toContain("Unknown");
				expect(text).not.toContain("kg × reps");
				expect(text).not.toContain("Personal-best awards");
				expect(text).not.toContain("Retained biceps");
				expect(text).not.toContain("Retained dumbbell");
				expect(within(document.body).queryByRole("columnheader", { name: "Est. 1RM" })).toBeNull();
			});
		}),
	);

	for (const [volume, imperial, label] of [
		[0, false, "0 kg × reps"],
		[0, true, "0 lb × reps"],
		[100.000001, false, "100.000001 kg × reps"],
		[100.000001, true, "220.46226438950018 lb × reps"],
	] as const) {
		it.live(`renders occurrence volume as ${label}`, () =>
			Effect.gen(function* () {
				const { settle } = mountProcessing(<Workout volume={volume} imperial={imperial} />);
				yield* settle("ready", () => {
					expect(within(document.body).getByText(label)).toBeTruthy();
				});
			}),
		);
	}
});
