import {
	addToCollectionAction,
	type BrowserResultsInput,
	EntityBrowserController,
} from "@ryot-app/plugin-client-sdk/browser";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	type ReportingCalendar,
	type TimeZone,
	usePageContext,
	usePageRefresh,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	paginationItems,
	PreferencesGate,
	useDisplayText,
	useFormatters,
	useRyot,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { useMemo, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { fitnessRoute } from "../../shared/workout-editor-routes";
import { DisplayPreferences } from "../display-preferences";
import { useFitnessMessages } from "../messages";
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
			<PreferencesGate>
				{({ timeZone, weekStart }) => <WorkoutsBody timeZone={timeZone} weekStart={weekStart} />}
			</PreferencesGate>
		</WorkoutProcessing>
	);
}

function WorkoutResults(props: {
	readonly now: Date;
	readonly timeZone: TimeZone;
	readonly weekStart: ReportingCalendar["weekStart"];
	readonly results: BrowserResultsInput<WorkoutPage>;
}) {
	return (
		<DisplayPreferences>
			{({ settings }) => <WorkoutCards {...props} imperial={settings.unitSystem === "imperial"} />}
		</DisplayPreferences>
	);
}

function SummaryLoader(props: ReportingCalendar & { readonly now: Date }) {
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
	readonly weekStart: ReportingCalendar["weekStart"];
	readonly results: BrowserResultsInput<WorkoutPage>;
	readonly window: { readonly endAt: string; readonly startAt: string };
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { now, cards, imperial, timeZone, weekStart } = props;
	const weeks = useRyotQuery(workoutWeeksQuery, {
		timeZone,
		...props.window,
		filter: props.results.controls.filter,
		search: props.results.controls.searchText,
	});
	const sections = useMemo(
		() =>
			groupByWeek(formatters, text, {
				now,
				cards,
				imperial,
				timeZone,
				weekStart,
				totals: weeks.data ?? [],
			}),
		[formatters, text, now, cards, imperial, timeZone, weekStart, weeks.data],
	);
	return (
		<WorkoutWeeks sections={sections} layout={props.layout} selection={props.results.selection} />
	);
}

function WorkoutCards(props: {
	readonly now: Date;
	readonly imperial: boolean;
	readonly timeZone: TimeZone;
	readonly weekStart: ReportingCalendar["weekStart"];
	readonly results: BrowserResultsInput<WorkoutPage>;
}) {
	const formatters = useFormatters();
	const { now, results, imperial, timeZone, weekStart } = props;
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
	const cards = useMemo(
		() => buildWorkoutCards(formatters, { now, items, imperial, timeZone, weekStart, comparisons }),
		[formatters, items, comparisons, now, imperial, timeZone, weekStart],
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
			weekStart={weekStart}
		/>
	);
}

function WorkoutsBody({ timeZone, weekStart }: ReportingCalendar) {
	const ryot = useRyot();
	const text = useFitnessMessages();
	const { view } = usePageContext();
	const displayText = useDisplayText();
	const [now, setNow] = useState(() => new Date());
	const filterFields = useMemo(
		() => workoutFilterFields(text, ryot.pluginIdentity(PLUGIN_PACKAGE_ID)),
		[ryot, text],
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
			icon={view?.icon ?? "dumbbell"}
			layouts={["grid", "list", "table"]}
			emptyMessage={text("client.workouts.empty")}
			errorTitle={text("client.workouts.unavailable")}
			errorMessage={text("client.workouts.load-failed")}
			name={view ? displayText(view.name) : text("client.workouts.title")}
			noun={(count) => text("common.unit.count", { count, noun: "workout" })}
			selection={{ readIds: readWorkoutIds, actions: [addToCollectionAction(ryot)] }}
			renderSummary={() => <SummaryLoader now={now} timeZone={timeZone} weekStart={weekStart} />}
			renderResults={(results) => (
				<WorkoutResults now={now} results={results} timeZone={timeZone} weekStart={weekStart} />
			)}
			add={{
				searchesOnline: false,
				label: text("client.workouts.start"),
				open: () => ryot.navigation.push(fitnessRoute("/workouts/new")),
			}}
		/>
	);
}
