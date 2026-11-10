import {
	addToCollectionAction,
	type BrowserResultsInput,
	EntityBrowserController,
} from "@ryot-app/plugin-client-sdk/browser";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { type TimeZone, usePageContext, usePageRefresh } from "@ryot-app/plugin-client-sdk/plugin";
import { paginationItems, useRyot, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { useMemo, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { fitnessRoute } from "../../shared/workout-editor-routes";
import { DisplayPreferences } from "../display-preferences";
import { ReportingPreferences } from "../reporting-preferences";
import { WorkoutProcessing } from "../workout-processing";
import { workoutFilterFields } from "./filters";
import {
	buildWorkoutCards,
	groupByWeek,
	type PeriodKey,
	weeksWindow,
	type WorkoutCard,
} from "./model";
import {
	countWorkouts,
	readWorkoutIds,
	type WorkoutPage,
	workoutsQuery,
	workoutSummaryQuery,
	workoutWeeksQuery,
} from "./queries";
import { WorkoutTable, WorkoutWeeks } from "./results";
import { WorkoutSummarySection } from "./summary";

export default function WorkoutsPage() {
	return (
		<WorkoutProcessing>
			<ReportingPreferences>
				{(timeZone) => <WorkoutsBody timeZone={timeZone} />}
			</ReportingPreferences>
		</WorkoutProcessing>
	);
}

function WorkoutResults(props: {
	readonly now: Date;
	readonly timeZone: TimeZone;
	readonly results: BrowserResultsInput<WorkoutPage>;
}) {
	return (
		<DisplayPreferences>
			{({ settings }) => <WorkoutCards {...props} imperial={settings.unitSystem === "imperial"} />}
		</DisplayPreferences>
	);
}

function SummaryLoader(props: { readonly now: Date; readonly timeZone: TimeZone }) {
	const [period, setPeriod] = useState<PeriodKey>("1M");
	const summary = useRyotQuery(workoutSummaryQuery, { period, timeZone: props.timeZone });
	return (
		<DisplayPreferences>
			{({ settings }) => (
				<WorkoutSummarySection
					{...props}
					period={period}
					summary={summary.data}
					isError={summary.isError}
					onRetry={summary.refetch}
					onPeriodChange={setPeriod}
					imperial={settings.unitSystem === "imperial"}
				/>
			)}
		</DisplayPreferences>
	);
}

function WeekResults(props: {
	readonly now: Date;
	readonly imperial: boolean;
	readonly timeZone: TimeZone;
	readonly layout: "grid" | "list";
	readonly cards: readonly WorkoutCard[];
	readonly results: BrowserResultsInput<WorkoutPage>;
	readonly window: { readonly endAt: string; readonly startAt: string };
}) {
	const { now, cards, imperial, timeZone } = props;
	const weeks = useRyotQuery(workoutWeeksQuery, {
		timeZone,
		...props.window,
		filter: props.results.controls.filter,
		search: props.results.controls.searchText,
	});
	const sections = useMemo(
		() => groupByWeek({ now, cards, imperial, timeZone, totals: weeks.data ?? [] }),
		[now, cards, imperial, timeZone, weeks.data],
	);
	return (
		<WorkoutWeeks sections={sections} layout={props.layout} selection={props.results.selection} />
	);
}

function WorkoutCards(props: {
	readonly now: Date;
	readonly imperial: boolean;
	readonly timeZone: TimeZone;
	readonly results: BrowserResultsInput<WorkoutPage>;
}) {
	const { now, results, imperial, timeZone } = props;
	const { items, pages, layout } = results;
	const comparisons = useMemo(
		() =>
			paginationItems(
				pages,
				(page) => page.comparisons,
				({ id }) => id,
			),
		[pages],
	);
	const targets = useMemo(
		() =>
			paginationItems(
				pages,
				(page) => page.targets,
				({ id }) => id,
			),
		[pages],
	);
	const cards = useMemo(
		() => buildWorkoutCards({ now, items, targets, imperial, timeZone, comparisons }),
		[items, comparisons, targets, now, imperial, timeZone],
	);
	const window = weeksWindow(cards);
	return layout === "table" || window === null ? (
		<WorkoutTable cards={cards} selection={results.selection} />
	) : (
		<WeekResults
			now={now}
			cards={cards}
			window={window}
			layout={layout}
			results={results}
			imperial={imperial}
			timeZone={timeZone}
		/>
	);
}

function WorkoutsBody({ timeZone }: { readonly timeZone: TimeZone }) {
	const ryot = useRyot();
	const { view } = usePageContext();
	const [now, setNow] = useState(() => new Date());
	const filterFields = useMemo(
		() => workoutFilterFields(ryot.pluginIdentity(PLUGIN_PACKAGE_ID)),
		[ryot],
	);
	usePageRefresh(() =>
		DateTime.now.pipe(
			Effect.flatMap((currentTime) => Effect.sync(() => setNow(DateTime.toDate(currentTime)))),
		),
	);
	return (
		<EntityBrowserController
			sortChoices={[]}
			defaultLayout="grid"
			query={workoutsQuery}
			count={countWorkouts}
			identityKey="workouts"
			filterFields={filterFields}
			name={view?.name ?? "Workouts"}
			icon={view?.icon ?? "dumbbell"}
			errorTitle="Workouts unavailable"
			layouts={["grid", "list", "table"]}
			noun={{ one: "workout", other: "workouts" }}
			errorMessage="Your workouts couldn't be loaded."
			renderSummary={() => <SummaryLoader now={now} timeZone={timeZone} />}
			selection={{ readIds: readWorkoutIds, actions: [addToCollectionAction(ryot)] }}
			emptyMessage="Start a workout, or import your history from Hevy or Strong, to see it here."
			renderResults={(results) => (
				<WorkoutResults now={now} results={results} timeZone={timeZone} />
			)}
			add={{
				searchesOnline: false,
				label: "Start workout",
				open: () => ryot.navigation.push(fitnessRoute("/workouts/new")),
			}}
		/>
	);
}
