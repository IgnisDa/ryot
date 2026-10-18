import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	FilterChips,
	FilterRules,
	useViewFilter,
	type ViewFilter,
	ViewFiltersSheet,
} from "@ryot-app/plugin-client-sdk/filters";
import {
	type EntityBrowserLayout,
	usePageContext,
	usePageRefresh,
	usePageShortcut,
	usePluginLocation,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	nextPageCursor,
	paginationItems,
	useRyot,
	useRyotInfiniteQuery,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
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
	LoadMoreButton,
	SearchField,
	SegmentedControl,
	StatusMessage,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { fitnessRoute } from "../../shared/workout-editor-routes";
import { DisplayPreferences } from "../display-preferences";
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
	workoutCountQuery,
	workoutsQuery,
	workoutSummaryQuery,
	workoutWeeksQuery,
} from "./queries";
import { WorkoutTable, WorkoutWeeks } from "./results";
import { WorkoutSummarySection } from "./summary";

export default function WorkoutsPage() {
	return (
		<WorkoutProcessing>
			<WorkoutsBody />
		</WorkoutProcessing>
	);
}

function SummaryLoader(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly imperial: boolean;
}) {
	const [period, setPeriod] = useState<PeriodKey>("1M");
	const summary = useRyotQuery(workoutSummaryQuery, { period, timeZone: props.timeZone });
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

function WorkoutCount(props: {
	readonly search: string;
	readonly filter: null | ViewFilter;
	readonly onTotal: (total: number) => void;
}) {
	const result = useRyotQuery(workoutCountQuery, { search: props.search, filter: props.filter });
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
	readonly timeZone: string;
	readonly imperial: boolean;
	readonly layout: "grid" | "list";
	readonly filter: null | ViewFilter;
	readonly cards: readonly WorkoutCard[];
	readonly window: { readonly endAt: string; readonly startAt: string };
}) {
	const { now, cards, imperial, timeZone } = props;
	const weeks = useRyotQuery(workoutWeeksQuery, {
		timeZone,
		...props.window,
		filter: props.filter,
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
	readonly search: string;
	readonly timeZone: string;
	readonly imperial: boolean;
	readonly filter: null | ViewFilter;
	readonly onClearFilters: () => void;
	readonly layout: EntityBrowserLayout;
	readonly onLoaded: (loaded: { readonly count: number; readonly hasMore: boolean }) => void;
}) {
	const { now, search, filter, imperial, timeZone, onLoaded } = props;
	const result = useRyotInfiniteQuery(
		workoutsQuery,
		{ search, filter },
		{
			initialPageParam: undefined,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
		},
	);
	const items = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.items,
				({ id }) => id,
			),
		[result.pages],
	);
	const comparisons = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.comparisons,
				({ id }) => id,
			),
		[result.pages],
	);
	const targets = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.targets,
				({ id }) => id,
			),
		[result.pages],
	);
	const cards = useMemo(
		() => buildWorkoutCards({ now, items, targets, imperial, timeZone, comparisons }),
		[items, comparisons, targets, now, imperial, timeZone],
	);
	useEffect(() => {
		if (result.pages.length > 0) {
			onLoaded({ count: items.length, hasMore: result.hasNextPage });
		}
	}, [items.length, onLoaded, result.hasNextPage, result.pages.length]);
	if (result.pages.length === 0) {
		return result.isError ? (
			<div className="flex flex-col items-start gap-3 font-ui">
				<StatusMessage tone="error">Your workouts couldn&apos;t be loaded.</StatusMessage>
				<Button variant="secondary" onClick={result.retry}>
					Try again
				</Button>
			</div>
		) : (
			<StatusMessage tone="pending" className="font-ui">
				{search === "" && filter === null ? "Loading workouts…" : "Searching…"}
			</StatusMessage>
		);
	}
	if (cards.length === 0) {
		return search === "" && filter === null ? (
			<EmptyState
				className="font-ui"
				title="No workouts yet"
				description="Start a workout, or import your history from Hevy or Strong, to see it here."
			/>
		) : (
			<EmptyState
				className="font-ui"
				title="No matching workouts"
				action={
					filter === null ? undefined : (
						<Button variant="secondary" onClick={props.onClearFilters}>
							Clear filters
						</Button>
					)
				}
				description={
					search === ""
						? "No workouts match these filters."
						: `No workout names contain “${search}”${filter === null ? "" : " and match these filters"}.`
				}
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
					filter={filter}
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
					<Button variant="secondary" onClick={result.retry} disabled={result.isFetching}>
						Try again
					</Button>
				</div>
			) : null}
			{result.hasNextPage && !result.isError ? (
				<LoadMoreButton
					variant="secondary"
					disabled={result.isFetching}
					onClick={result.fetchNextPage}
					className="self-center font-ui"
					isFetchingNextPage={result.isFetchingNextPage}
					label={props.layout === "table" ? "Load more workouts" : "Show earlier weeks"}
				/>
			) : null}
		</div>
	);
}

function WorkoutsBody() {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const { view } = usePageContext();
	const { compact } = useRyotViewport();
	const location = usePluginLocation();
	const filterFields = useMemo(
		() => workoutFilterFields(ryot.pluginIdentity(PLUGIN_PACKAGE_ID)),
		[ryot],
	);
	const { filter, setFilter, activeCount } = useViewFilter(filterFields);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const filtersTrigger = useRef<HTMLButtonElement>(null);
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
	useValueChange(params.get("filters"), () => {
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
			<ViewFiltersButton
				ref={filtersTrigger}
				activeCount={activeCount}
				onClick={() => setFiltersOpen(true)}
			/>
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
				<>
					{loaded === undefined ? null : (
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
								<Button variant="link" onClick={() => setShowCount(true)}>
									Count all
								</Button>
							) : null}
							{loaded.hasMore && showCount ? (
								<WorkoutCount search={search} onTotal={setTotal} filter={filter ?? null} />
							) : null}
						</div>
					)}
					<FilterChips
						filter={filter}
						onChange={setFilter}
						fields={filterFields}
						onOpen={() => setFiltersOpen(true)}
					/>
				</>
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
							filter={filter ?? null}
							onClearFilters={() => setFilter(undefined)}
							imperial={settings.unitSystem === "imperial"}
						/>
					</div>
				)}
			</DisplayPreferences>
			{filtersOpen ? (
				<ViewFiltersSheet
					title="Filters"
					compact={compact}
					triggerRef={filtersTrigger}
					onClose={() => setFiltersOpen(false)}
				>
					<FilterRules
						filter={filter}
						compact={compact}
						onChange={setFilter}
						fields={filterFields}
					/>
				</ViewFiltersSheet>
			) : null}
		</PluginScreenFrame>
	);
}
