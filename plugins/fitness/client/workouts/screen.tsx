import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	usePageContext,
	usePageRefresh,
	usePageShortcut,
	usePluginLocation,
	useRyotViewport,
	type EntityBrowserLayout,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotQuery, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import {
	normalizeViewSearch,
	PluginScreenFrame,
	ViewFiltersButton,
	viewLayoutOptions,
	viewResultLabel,
} from "@ryot-app/plugin-client-sdk/screen";
import {
	Button,
	EmptyState,
	SearchField,
	SegmentedControl,
	StatusMessage,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { fitnessRoute } from "../../shared/workout-editor-routes";
import { DisplayPreferences } from "../display-preferences";
import {
	buildWorkoutCards,
	groupByWeek,
	summaryWindows,
	weeksWindow,
	type PeriodKey,
	type WorkoutCard,
} from "./model";
import {
	workoutCountQuery,
	workoutsQuery,
	workoutWeeksQuery,
	workoutSummaryQuery,
} from "./queries";
import { WorkoutTable, WorkoutWeeks } from "./results";
import { WorkoutSummarySection } from "./summary";

function WorkoutCount(props: {
	readonly search: string;
	readonly onTotal: (total: number) => void;
}) {
	const result = useRyotQuery(workoutCountQuery, { search: props.search });
	const { onTotal } = props;
	useEffect(() => {
		if (result.data !== undefined) {
			onTotal(result.data);
		}
	}, [onTotal, result.data]);
	if (result.isError) {
		return (
			<Button variant="ghost" onClick={result.refetch} className="text-sm text-danger">
				Count failed · retry
			</Button>
		);
	}
	return result.data === undefined ? <span>Counting…</span> : null;
}

function WeekResults(props: {
	readonly now: Date;
	readonly search: string;
	readonly imperial: boolean;
	readonly timeZone: string;
	readonly layout: "grid" | "list";
	readonly cards: readonly WorkoutCard[];
	readonly window: { readonly startAt: string; readonly endAt: string };
}) {
	const { now, cards, imperial, timeZone } = props;
	const weeks = useRyotQuery(workoutWeeksQuery, {
		timeZone,
		...props.window,
		search: props.search,
	});
	const sections = useMemo(
		() => groupByWeek({ now, cards, imperial, timeZone, totals: weeks.data ?? [] }),
		[now, cards, imperial, timeZone, weeks.data],
	);
	return <WorkoutWeeks sections={sections} layout={props.layout} />;
}

function WorkoutResults(props: {
	readonly now: Date;
	readonly layout: EntityBrowserLayout;
	readonly search: string;
	readonly imperial: boolean;
	readonly timeZone: string;
	readonly onLoaded: (loaded: { readonly count: number; readonly hasMore: boolean }) => void;
}) {
	const { now, search, imperial, timeZone, onLoaded } = props;
	const [pages, setPages] = useState(1);
	useValueChange(search, () => setPages(1));
	const result = useRyotQuery(workoutsQuery, { pages, search });
	const [shown, setShown] = useState(result.data);
	if (result.data !== undefined && result.data !== shown) {
		setShown(result.data);
	}
	const cards = useMemo(
		() => (shown === undefined ? [] : buildWorkoutCards({ ...shown, now, imperial, timeZone })),
		[shown, now, imperial, timeZone],
	);
	useEffect(() => {
		if (shown !== undefined) {
			onLoaded({ hasMore: shown.hasMore, count: shown.items.length });
		}
	}, [onLoaded, shown]);
	if (shown === undefined) {
		return result.isError ? (
			<div className="flex flex-col items-start gap-3 font-ui">
				<StatusMessage tone="error">Your workouts couldn&apos;t be loaded.</StatusMessage>
				<Button variant="secondary" onClick={result.refetch}>
					Try again
				</Button>
			</div>
		) : (
			<StatusMessage tone="pending" className="font-ui">
				{search === "" ? "Loading workouts…" : "Searching…"}
			</StatusMessage>
		);
	}
	if (cards.length === 0) {
		return search === "" ? (
			<EmptyState
				className="font-ui"
				title="No workouts yet"
				description="Start a workout, or import your history from Hevy or Strong, to see it here."
			/>
		) : (
			<EmptyState
				className="font-ui"
				title="No matching workouts"
				description={`No workout names contain “${search}”.`}
			/>
		);
	}
	const window = weeksWindow(cards);
	return (
		<div className="flex min-w-0 flex-col gap-5">
			{props.layout === "table" || window === null ? (
				<WorkoutTable cards={cards} />
			) : (
				<WeekResults
					now={now}
					cards={cards}
					search={search}
					window={window}
					imperial={imperial}
					timeZone={timeZone}
					layout={props.layout}
				/>
			)}
			{result.isError ? (
				<div className="flex flex-col items-center gap-3 font-ui">
					<StatusMessage tone="error">More workouts couldn&apos;t be loaded.</StatusMessage>
					<Button variant="secondary" onClick={result.refetch} disabled={result.isFetching}>
						Try again
					</Button>
				</div>
			) : null}
			{shown.hasMore && !result.isError ? (
				<Button
					variant="secondary"
					disabled={result.isFetching}
					className="self-center font-ui"
					onClick={() => setPages((current) => current + 1)}
				>
					{props.layout === "table" ? "Load more workouts" : "Show earlier weeks"}
				</Button>
			) : null}
		</div>
	);
}

function SummaryLoader(props: {
	readonly now: Date;
	readonly imperial: boolean;
	readonly timeZone: string;
}) {
	const [period, setPeriod] = useState<PeriodKey>("1M");
	const summary = useRyotQuery(workoutSummaryQuery, {
		timeZone: props.timeZone,
		...summaryWindows(period, props.now),
	});
	return (
		<WorkoutSummarySection
			{...props}
			period={period}
			summary={summary.data}
			isError={summary.isError}
			onRetry={summary.refetch}
			onPeriodChange={setPeriod}
		/>
	);
}

export default function WorkoutsPage() {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const { view } = usePageContext();
	const { compact } = useRyotViewport();
	const location = usePluginLocation();
	const params = new URLSearchParams(location.search);
	const requestedLayout = params.get("layout");
	const search = params.get("search") ?? "";
	const layout = viewLayoutOptions.find(({ value }) => value === requestedLayout)?.value ?? "grid";
	const [draftSearch, setDraftSearch] = useState(search);
	const [loaded, setLoaded] = useState<{ readonly count: number; readonly hasMore: boolean }>();
	const [showCount, setShowCount] = useState(false);
	const [total, setTotal] = useState<number>();
	const [now, setNow] = useState(() => new Date());
	const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
	const searchInput = useRef<HTMLInputElement>(null);
	const name = view?.name ?? "Workouts";
	usePageRefresh(() =>
		DateTime.now.pipe(
			Effect.flatMap((currentTime) => Effect.sync(() => setNow(DateTime.toDate(currentTime)))),
		),
	);
	useValueChange(search, () => {
		setDraftSearch(search);
		setShowCount(false);
		setTotal(undefined);
	});
	const commitSearch = (value: string) => {
		const next = normalizeViewSearch(value);
		if (next !== search) {
			ryot.navigation.pageSearch.replace({ search: next || null });
		}
	};
	const commitDraft = useEffectEvent((value: string) => commitSearch(value));
	useEffect(() => schedule.after(300, () => commitDraft(draftSearch)), [draftSearch, schedule]);
	const start = () => ryot.navigation.push(fitnessRoute("/workouts/new"));
	usePageShortcut("A", start);
	usePageShortcut("/", () => searchInput.current?.focus());
	const controls = (
		<div className={clsx("flex flex-wrap items-center gap-2.5", compact && "pb-4")}>
			<SearchField
				shortcut="/"
				value={draftSearch}
				inputRef={searchInput}
				label={`Search ${name}`}
				onChange={setDraftSearch}
				onSubmit={() => commitSearch(draftSearch)}
				icon={<AppIcon size={15} name="search" />}
				clearIcon={<AppIcon name="x" size={14} />}
				className={compact ? "h-9.5 w-full" : "h-8.5 w-60"}
			/>
			<SegmentedControl
				value={layout}
				label={`${name} layout`}
				options={viewLayoutOptions}
				onChange={(value) => ryot.navigation.pageSearch.replace({ layout: value })}
			/>
			<ViewFiltersButton onClick={() => console.log("TODO: open workout filters")} />
			<button
				type="button"
				onClick={start}
				aria-keyshortcuts="A"
				className="flex h-8.5 items-center gap-2 rounded-md bg-accent px-3.5"
			>
				<AppIcon size={15} name="plus" className="text-accent-ink" />
				<span className="text-[13px] font-semibold text-accent-ink">Start workout</span>
			</button>
		</div>
	);
	return (
		<PluginScreenFrame
			title={name}
			actions={compact ? undefined : controls}
			titleIcon={
				<AppIcon size={20} name={view?.icon ?? "dumbbell"} className="shrink-0 text-text-muted" />
			}
			meta={
				loaded === undefined ? undefined : (
					<div
						role="status"
						className="flex h-10 items-center gap-2 text-xs text-text-muted @2xl:text-sm"
					>
						<span>
							{viewResultLabel({
								total,
								loaded: loaded.count,
								hasMore: loaded.hasMore,
								noun: { one: "workout", other: "workouts" },
							})}
						</span>
						{loaded.hasMore && !showCount ? (
							<Button
								variant="ghost"
								onClick={() => setShowCount(true)}
								className="text-sm text-accent-text"
							>
								Count all
							</Button>
						) : null}
						{loaded.hasMore && showCount ? (
							<WorkoutCount search={search} onTotal={setTotal} />
						) : null}
					</div>
				)
			}
		>
			{compact ? controls : null}
			<DisplayPreferences>
				{({ settings }) => (
					<div className="flex min-w-0 flex-col gap-7">
						<SummaryLoader
							now={now}
							timeZone={timeZone}
							imperial={settings.unitSystem === "imperial"}
						/>
						<WorkoutResults
							now={now}
							layout={layout}
							search={search}
							timeZone={timeZone}
							onLoaded={setLoaded}
							imperial={settings.unitSystem === "imperial"}
						/>
					</div>
				)}
			</DisplayPreferences>
		</PluginScreenFrame>
	);
}
