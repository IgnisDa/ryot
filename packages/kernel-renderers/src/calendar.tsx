import { Effect, Result } from "@ryot-app/plugin-client-sdk/effect";
import { ViewFiltersSheet } from "@ryot-app/plugin-client-sdk/filters";
import {
	PluginLink,
	usePageContext,
	usePluginLocation,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	localDay,
	ManagedAssetProvider,
	useAssetUrl,
	useRyot,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	Button,
	type GroupColor,
	groupColors,
	groupColorVariable,
	IconButton,
	ScreenBarButton,
	SegmentedControl,
	StatusMessage,
	Switch,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import {
	type CalendarOccurrence,
	calendarOccurrencesPageRecipe,
	type CalendarSource,
	calendarSourcesRecipe,
	type CalendarWindow,
} from "@ryot-app/ryotql-recipes/calendar";
import clsx from "clsx";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

export const MAX_SOURCE_OCCURRENCES = 1000;

const MONTH_CELL_ITEMS = 3;

type Layout = "month" | "agenda";

type SourceFeedData = {
	readonly truncated: boolean;
	readonly items: readonly CalendarOccurrence[];
};

type Entry = {
	readonly key: string;
	readonly day: string;
	readonly color: GroupColor;
	readonly source: CalendarSource;
	readonly occurrence: CalendarOccurrence;
};

type FeedState = {
	readonly failed: boolean;
	readonly pending: boolean;
	readonly windowKey: string;
	readonly retry: () => void;
	readonly truncated: boolean;
	readonly items: readonly CalendarOccurrence[];
};

const pad = (value: number) => String(value).padStart(2, "0");

const localMonthKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

const parseMonth = (value: null | string) =>
	value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;

const monthParts = (month: string) => {
	const [year = 1970, index = 1] = month.split("-").map(Number);
	return { year, index };
};

const shiftMonth = (month: string, delta: number) => {
	const { year, index } = monthParts(month);
	return localMonthKey(new Date(year, index - 1 + delta, 1));
};

const dayDate = (day: string) => {
	const [year = 1970, index = 1, date = 1] = day.split("-").map(Number);
	return new Date(year, index - 1, date);
};

const calendarWindow = (month: string): CalendarWindow => {
	const { year, index } = monthParts(month);
	return {
		month,
		localEnd: new Date(year, index, 1).toISOString(),
		localStart: new Date(year, index - 1, 1).toISOString(),
	};
};

const occurrenceDay = (occurrence: CalendarOccurrence) =>
	occurrence.precision === "date"
		? occurrence.startAt.slice(0, 10)
		: localDay(new Date(occurrence.startAt));

const monthLabel = (month: string) => {
	const { year, index } = monthParts(month);
	return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
		new Date(year, index - 1, 1),
	);
};

const timeLabel = (occurrence: CalendarOccurrence) =>
	occurrence.precision === "date"
		? ""
		: new Intl.DateTimeFormat(undefined, {
				hour: "2-digit",
				hourCycle: "h23",
				minute: "2-digit",
			}).format(new Date(occurrence.startAt));

const weekdayLabel = (date: Date, weekday: "long" | "short") =>
	new Intl.DateTimeFormat(undefined, { weekday }).format(date);

const dayLabel = (day: string) =>
	new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", weekday: "long" }).format(
		dayDate(day),
	);

const weekdayHeaders = Array.from({ length: 7 }, (_, offset) =>
	weekdayLabel(new Date(2024, 0, 1 + offset), "short"),
);

const compareEntries = (left: Entry, right: Entry) =>
	(left.occurrence.precision === "date" ? 0 : 1) -
		(right.occurrence.precision === "date" ? 0 : 1) ||
	left.occurrence.startAt.localeCompare(right.occurrence.startAt) ||
	left.source.name.localeCompare(right.source.name) ||
	left.occurrence.subject.name.localeCompare(right.occurrence.subject.name) ||
	(left.occurrence.caption ?? "").localeCompare(right.occurrence.caption ?? "");

const sourcesQuery = createRyotQuery(({ client }) => client.data.query(calendarSourcesRecipe()), {
	cancelOnUnmount: true,
});

function DoneMark() {
	return (
		<span role="img" aria-label="Done" className="inline-flex shrink-0 text-success">
			<AppIcon size={16} name="circle-check" />
		</span>
	);
}

function SourceDot({
	color,
	size = "size-2",
}: {
	readonly size?: string;
	readonly color: GroupColor;
}) {
	return (
		<span
			aria-hidden="true"
			className={clsx(size, "shrink-0 rounded-pill")}
			style={{ background: groupColorVariable(color) }}
		/>
	);
}

function OccurrenceArt({ size, entry }: { readonly entry: Entry; readonly size: "sm" | "md" }) {
	const url = useAssetUrl(entry.occurrence.art ?? undefined);
	const box = size === "md" ? "h-14 w-14" : "h-12 w-12";
	if (entry.occurrence.art !== null) {
		return (
			<EntityArtWell
				url={url}
				state="ready"
				className={clsx(box, "shrink-0 rounded-md")}
				monogram={entry.occurrence.subject.name.slice(0, 1).toUpperCase()}
			/>
		);
	}
	return (
		<div
			data-testid="calendar-icon-tile"
			className={clsx(box, "grid shrink-0 place-items-center rounded-md")}
			style={{
				color: groupColorVariable(entry.color),
				background: groupColorVariable(entry.color, { soft: true }),
			}}
		>
			<AppIcon name={entry.source.icon} size={size === "md" ? 26 : 22} />
		</div>
	);
}

function AgendaRow({
	past,
	entry,
	compact,
}: {
	readonly entry: Entry;
	readonly past: boolean;
	readonly compact: boolean;
}) {
	const { occurrence } = entry;
	return (
		<li className="border-t border-border first:border-t-0">
			<PluginLink
				data-past={past ? "" : undefined}
				to={{ kind: "entity", entityId: occurrence.subject.id }}
				className={clsx(
					"flex min-h-11 items-center gap-3.5 px-3.5 py-2.5 text-text hover:bg-hover",
					past && "opacity-70",
				)}
			>
				<OccurrenceArt entry={entry} size={compact ? "sm" : "md"} />
				<span className="grid min-w-0 flex-1 gap-0.5">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate text-sm font-semibold">{occurrence.subject.name}</span>
						{occurrence.done && <DoneMark />}
					</span>
					<span className="flex min-w-0 items-center gap-1.5 text-[13px] text-text-muted">
						{compact && <SourceDot color={entry.color} />}
						<span className="truncate">{occurrence.caption ?? entry.source.name}</span>
					</span>
				</span>
				{!compact && (
					<span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
						<SourceDot color={entry.color} />
						{entry.source.name}
					</span>
				)}
				<time
					data-testid="calendar-time"
					dateTime={occurrence.startAt}
					className="w-16 shrink-0 text-right text-[13px] tabular-nums"
				>
					{timeLabel(occurrence)}
				</time>
			</PluginLink>
		</li>
	);
}

function SourceFeed({
	source,
	window,
	onState,
}: {
	readonly source: CalendarSource;
	readonly window: CalendarWindow;
	readonly onState: (sourceKey: string, state: FeedState | undefined) => void;
}) {
	const [query] = useState(() =>
		createRyotQuery<CalendarWindow, SourceFeedData, undefined, Error>(
			({ input, client }) =>
				Effect.gen(function* () {
					const items: CalendarOccurrence[] = [];
					let after: string | undefined;
					for (;;) {
						const recipe = calendarOccurrencesPageRecipe({ after, source, window: input });
						if (Result.isFailure(recipe)) {
							return yield* Effect.fail(recipe.failure);
						}
						const page = yield* client.data.query(recipe.success);
						items.push(...page.items);
						const next = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
						if (next === null) {
							return { items, truncated: false };
						}
						if (items.length >= MAX_SOURCE_OCCURRENCES) {
							return { truncated: true, items: items.slice(0, MAX_SOURCE_OCCURRENCES) };
						}
						after = next;
					}
				}),
			{ cancelOnUnmount: true },
		),
	);
	const windowKey = JSON.stringify(window);
	const result = useRyotQuery(query, window);
	const { data, refetch, isError, isPending } = result;
	useEffect(() => {
		onState(source.sourceKey, {
			windowKey,
			retry: refetch,
			failed: isError,
			pending: isPending,
			items: data?.items ?? [],
			truncated: data?.truncated ?? false,
		});
	}, [data, isError, isPending, onState, refetch, source.sourceKey, windowKey]);
	useEffect(() => () => onState(source.sourceKey, undefined), [onState, source.sourceKey]);
	return null;
}

function Agenda({
	days,
	today,
	compact,
	focusDay,
	onFocused,
	emptyLabel,
}: {
	readonly today: string;
	readonly compact: boolean;
	readonly emptyLabel: string;
	readonly onFocused: () => void;
	readonly focusDay: string | undefined;
	readonly days: readonly (readonly [string, readonly Entry[]])[];
}) {
	const headings = useRef(new Map<string, HTMLElement>());
	const focusReady = days.some(([day]) => day === focusDay);
	useEffect(() => {
		if (focusDay !== undefined && focusReady) {
			headings.current.get(focusDay)?.focus();
			onFocused();
		}
	}, [focusDay, focusReady, onFocused]);
	if (days.length === 0) {
		return (
			<p className="rounded-lg border border-border bg-surface p-12 text-center text-sm text-text-muted">
				{emptyLabel}
			</p>
		);
	}
	return (
		<div className="grid gap-1.5">
			{days.map(([day, entries]) => {
				const date = dayDate(day);
				const past = day < today;
				return (
					<section
						key={day}
						data-day={day}
						aria-label={dayLabel(day)}
						className={clsx(
							"grid gap-2 border-t border-border py-3.5",
							!compact && "grid-cols-[96px_minmax(0,1fr)] gap-4",
						)}
					>
						<h2
							tabIndex={-1}
							className="flex items-start gap-2.5 outline-none"
							ref={(element) => {
								if (element === null) {
									headings.current.delete(day);
								} else {
									headings.current.set(day, element);
								}
							}}
						>
							<span
								className={clsx(
									"font-display leading-none font-semibold",
									compact ? "text-xl" : "text-[30px]",
									past ? "text-text-subtle" : "text-text",
								)}
							>
								{date.getDate()}
							</span>
							<span className="grid gap-1 pt-0.5">
								<span className="text-xs text-text-muted">
									{weekdayLabel(date, compact ? "long" : "short")}
								</span>
								{day === today && (
									<span className="rounded-pill bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">
										Today
									</span>
								)}
							</span>
						</h2>
						<ul className="overflow-hidden rounded-lg border border-border bg-surface">
							{entries.map((entry) => (
								<AgendaRow past={past} entry={entry} key={entry.key} compact={compact} />
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

const cellLabel = (day: string, count: number) =>
	`${dayLabel(day)}, ${count} ${count === 1 ? "item" : "items"}`;

export default function CalendarPage() {
	const ryot = useRyot();
	const page = usePageContext();
	const schedule = useRyotSchedule();
	const location = usePluginLocation();
	const { compact, safeAreaBottom } = useRyotViewport();
	const name = page.view?.name ?? "Calendar";
	const icon = page.view?.icon ?? "calendar";
	const now = new Date(schedule.now());
	const today = localDay(now);
	const params = new URLSearchParams(location.search);
	const requested = {
		month: parseMonth(params.get("month")) ?? localMonthKey(now),
		layout: params.get("layout") === "month" ? ("month" as const) : ("agenda" as const),
	};
	const [view, setView] = useState(requested);
	useValueChange(`${requested.month}|${requested.layout}`, () => setView(requested));
	const [focusDay, setFocusDay] = useState<string>();
	const clearFocusDay = useCallback(() => setFocusDay(undefined), []);
	const [sheetOpen, setSheetOpen] = useState(false);
	const sheetTrigger = useRef<HTMLButtonElement>(null);
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	const [toggleFailure, setToggleFailure] = useState<string>();
	const [feeds, setFeeds] = useState<ReadonlyMap<string, FeedState>>(new Map());
	const reportFeed = useCallback((sourceKey: string, state: FeedState | undefined) => {
		setFeeds((current) => {
			const next = new Map(current);
			if (state === undefined) {
				next.delete(sourceKey);
			} else {
				next.set(sourceKey, state);
			}
			return next;
		});
	}, []);
	const sourcesResult = useRyotQuery(sourcesQuery);
	const sources = sourcesResult.data ?? [];
	const colors = new Map(
		sources.map((source, position) => [
			source.sourceKey,
			groupColors[position % groupColors.length] ?? "blue",
		]),
	);
	const visible = sources.filter(({ isHidden }) => !isHidden);
	const window = calendarWindow(view.month);
	const windowKey = JSON.stringify(window);
	const entries: Entry[] = visible.flatMap((source) => {
		const feed = feeds.get(source.sourceKey);
		if (feed?.windowKey !== windowKey) {
			return [];
		}
		const seen = new Map<string, number>();
		return feed.items.flatMap((occurrence) => {
			const day = occurrenceDay(occurrence);
			if (!day.startsWith(`${view.month}-`)) {
				return [];
			}
			const repeat = seen.get(occurrence.key) ?? 0;
			seen.set(occurrence.key, repeat + 1);
			return [
				{
					day,
					source,
					occurrence,
					color: colors.get(source.sourceKey) ?? "blue",
					key: JSON.stringify([source.sourceKey, occurrence.key, repeat]),
				},
			];
		});
	});
	entries.sort((left, right) => left.day.localeCompare(right.day) || compareEntries(left, right));
	const byDay = new Map<string, Entry[]>();
	for (const entry of entries) {
		byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
	}
	const counts = new Map<string, number>();
	for (const entry of entries) {
		counts.set(entry.source.sourceKey, (counts.get(entry.source.sourceKey) ?? 0) + 1);
	}
	const visibleFeeds = visible.map((source) => ({ source, feed: feeds.get(source.sourceKey) }));
	const loading =
		sourcesResult.isPending ||
		visibleFeeds.some(
			({ feed }) => feed === undefined || feed.windowKey !== windowKey || feed.pending,
		);
	const failed = visibleFeeds.filter(({ feed }) => feed?.windowKey === windowKey && feed.failed);
	const truncated = visibleFeeds.filter(
		({ feed }) => feed?.windowKey === windowKey && feed.truncated,
	);
	const hiddenCount = sources.length - visible.length;
	const assets = entries.flatMap(({ occurrence }) =>
		occurrence.art !== null && occurrence.art.type !== "remote" ? [occurrence.art] : [],
	);

	const navigate = (next: { readonly month?: string; readonly layout?: Layout }) => {
		const target = { ...view, ...next };
		if (target.month !== view.month) {
			setFocusDay(undefined);
		}
		setView(target);
		ryot.navigation.pageSearch.replace({
			month: target.month,
			layout: target.layout === "month" ? "month" : null,
		});
	};
	const showDay = (day: string) => {
		setFocusDay(day);
		navigate({ layout: "agenda" });
	};
	const toggle = (source: CalendarSource) => {
		setToggleFailure(undefined);
		setPending((current) => new Set(current).add(source.sourceKey));
		schedule.run(
			ryot.calendarSources
				.setVisibility({ slug: source.slug, pluginId: source.pluginId, isHidden: !source.isHidden })
				.pipe(Effect.catch(() => Effect.sync(() => setToggleFailure(source.name)))),
			() =>
				setPending((current) => {
					const next = new Set(current);
					next.delete(source.sourceKey);
					return next;
				}),
		);
	};

	const layoutSwitch = (
		<SegmentedControl
			value={view.layout}
			optionClassName="px-3"
			label="Calendar layout"
			onChange={(layout) => navigate({ layout })}
			options={[
				{ value: "agenda", label: "Agenda", content: "Agenda" },
				{ value: "month", label: "Month", content: "Month" },
			]}
		/>
	);
	const monthNavigation = (
		<div className={clsx("flex items-center gap-0.5", compact && "w-full")}>
			<IconButton
				tone="ghost"
				label="Previous month"
				onClick={() => navigate({ month: shiftMonth(view.month, -1) })}
			>
				<AppIcon size={18} name="chevron-left" />
			</IconButton>
			<span
				aria-live="polite"
				className={clsx(
					"text-center text-[15px] font-semibold text-text",
					compact ? "flex-1" : "min-w-32",
				)}
			>
				{monthLabel(view.month)}
			</span>
			<IconButton
				tone="ghost"
				label="Next month"
				onClick={() => navigate({ month: shiftMonth(view.month, 1) })}
			>
				<AppIcon size={18} name="chevron-right" />
			</IconButton>
		</div>
	);
	const todayButton = (
		<Button
			size="sm"
			variant="outline"
			onClick={() => {
				navigate({ month: localMonthKey(now) });
				setFocusDay(today);
			}}
		>
			Today
		</Button>
	);

	let content: ReactNode;
	if (sourcesResult.isPending) {
		content = <StatusMessage tone="pending">Loading calendar...</StatusMessage>;
	} else if (sourcesResult.isError && sourcesResult.data === undefined) {
		content = (
			<StatusMessage tone="error">
				Calendar sources are unavailable.{" "}
				<Button variant="ghost" onClick={sourcesResult.refetch}>
					Retry
				</Button>
			</StatusMessage>
		);
	} else if (sources.length === 0) {
		content = (
			<p className="rounded-lg border border-border bg-surface p-12 text-center text-sm text-text-muted">
				No installed plugin adds calendar sources yet.
			</p>
		);
	} else if (view.layout === "month") {
		content = (
			<MonthGrid
				today={today}
				byDay={byDay}
				compact={compact}
				month={view.month}
				onShowDay={showDay}
			/>
		);
	} else {
		content = (
			<Agenda
				today={today}
				compact={compact}
				days={[...byDay]}
				focusDay={focusDay}
				onFocused={clearFocusDay}
				emptyLabel={
					loading ? "Loading..." : `Nothing in ${monthLabel(view.month)} from the sources you show.`
				}
			/>
		);
	}

	return (
		<ManagedAssetProvider assets={assets}>
			{visible.map((source) => (
				<SourceFeed
					window={window}
					source={source}
					onState={reportFeed}
					key={JSON.stringify([
						source.sourceKey,
						source.query,
						source.subject,
						source.startAt,
						source.precision,
						source.caption,
						source.art,
						source.done,
					])}
				/>
			))}
			<PluginScreenFrame
				title={name}
				titleIcon={<AppIcon size={22} name={icon} className="shrink-0 text-text-muted" />}
				actions={
					<div className="flex flex-wrap items-center gap-2">
						{todayButton}
						{monthNavigation}
						{layoutSwitch}
					</div>
				}
				meta={
					compact ? (
						<div className="flex items-center justify-between gap-3">
							{monthNavigation}
							{layoutSwitch}
						</div>
					) : undefined
				}
				barActions={
					<>
						{todayButton}
						<ScreenBarButton
							ref={sheetTrigger}
							className="relative text-text"
							onClick={() => setSheetOpen(true)}
							label={hiddenCount === 0 ? "Sources" : `Sources, ${hiddenCount} hidden`}
						>
							<AppIcon size={22} name="sliders-horizontal" />
							{hiddenCount > 0 && (
								<span
									aria-hidden="true"
									className="absolute top-0.5 right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-pill bg-accent px-1 text-[11px] font-semibold text-accent-ink"
								>
									{hiddenCount}
								</span>
							)}
						</ScreenBarButton>
					</>
				}
			>
				<div
					className="mx-auto grid w-full max-w-5xl"
					style={{ paddingBottom: safeAreaBottom + 48 }}
				>
					{!compact && sources.length > 0 && (
						<SourceChips
							counts={counts}
							colors={colors}
							pending={pending}
							sources={sources}
							onToggle={toggle}
						/>
					)}
					{(failed.length > 0 || truncated.length > 0 || toggleFailure !== undefined) && (
						<Notices>
							{toggleFailure !== undefined && (
								<StatusMessage tone="error">{`Couldn't update ${toggleFailure}. Try again.`}</StatusMessage>
							)}
							{failed.map(({ feed, source }) => (
								<div
									role="alert"
									key={source.sourceKey}
									className="flex flex-wrap items-center gap-2 text-sm text-danger"
								>
									<span>{`${source.name} could not be loaded.`}</span>
									<Button size="sm" variant="ghost" onClick={feed?.retry}>
										Retry
									</Button>
								</div>
							))}
							{truncated.map(({ source }) => (
								<StatusMessage tone="pending" key={source.sourceKey}>
									{`Showing the first ${MAX_SOURCE_OCCURRENCES.toLocaleString()} items from ${source.name}.`}
								</StatusMessage>
							))}
						</Notices>
					)}
					{content}
				</div>
			</PluginScreenFrame>
			{compact && sheetOpen && (
				<SourcesSheet
					sources={sources}
					pending={pending}
					onToggle={toggle}
					triggerRef={sheetTrigger}
					onClose={() => setSheetOpen(false)}
				/>
			)}
		</ManagedAssetProvider>
	);
}

function Notices({ children }: { readonly children: ReactNode }) {
	return <div className="mb-4 grid gap-2">{children}</div>;
}

function SourcesSheet({
	sources,
	pending,
	onClose,
	onToggle,
	triggerRef,
}: {
	readonly onClose: () => void;
	readonly pending: ReadonlySet<string>;
	readonly sources: readonly CalendarSource[];
	readonly onToggle: (source: CalendarSource) => void;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const groups = new Map<string, CalendarSource[]>();
	for (const source of sources) {
		const group = source.pluginName ?? "";
		groups.set(group, [...(groups.get(group) ?? []), source]);
	}
	return (
		<ViewFiltersSheet compact title="Sources" onClose={onClose} triggerRef={triggerRef}>
			<p className="mt-2 text-label text-text-muted">
				Each installed plugin can add sources. What you hide is saved to your account.
			</p>
			{[...groups].map(([group, items]) => (
				<div key={group} className="mt-4 grid gap-1">
					<h3 className="px-0.5 text-xs font-medium text-text-muted">{group}</h3>
					<ul className="overflow-hidden rounded-lg border border-border">
						{items.map((source) => (
							<li
								key={source.sourceKey}
								className="flex min-h-12 items-center gap-3 border-t border-border px-3.5 first:border-t-0"
							>
								<span
									className={clsx(
										"flex-1 font-medium",
										source.isHidden ? "text-text-muted" : "text-text",
									)}
								>
									{source.name}
								</span>
								<Switch
									checked={!source.isHidden}
									label={`Show ${source.name}`}
									onChange={() => onToggle(source)}
									disabled={pending.has(source.sourceKey)}
								/>
							</li>
						))}
					</ul>
				</div>
			))}
		</ViewFiltersSheet>
	);
}

function SourceChips({
	counts,
	colors,
	sources,
	pending,
	onToggle,
}: {
	readonly pending: ReadonlySet<string>;
	readonly sources: readonly CalendarSource[];
	readonly counts: ReadonlyMap<string, number>;
	readonly colors: ReadonlyMap<string, GroupColor>;
	readonly onToggle: (source: CalendarSource) => void;
}) {
	const hidden = sources.filter(({ isHidden }) => isHidden).length;
	return (
		<section aria-label="Sources" className="mb-5 grid gap-2">
			<div className="flex flex-wrap gap-2">
				{sources.map((source) => {
					const color = colors.get(source.sourceKey) ?? "blue";
					return (
						<button
							type="button"
							key={source.sourceKey}
							aria-pressed={!source.isHidden}
							onClick={() => onToggle(source)}
							disabled={pending.has(source.sourceKey)}
							className={clsx(
								"flex h-8.5 items-center gap-2 rounded-pill border border-border pr-3 pl-2.5 text-[13px] hover:border-border-emphasis disabled:opacity-60",
								source.isHidden ? "text-text-muted" : "bg-surface text-text",
							)}
						>
							<span
								aria-hidden="true"
								className="size-2.5 rounded-pill border-2"
								style={{
									borderColor: groupColorVariable(color),
									background: source.isHidden ? "transparent" : groupColorVariable(color),
								}}
							/>
							<span className={clsx("font-medium", source.isHidden && "line-through")}>
								{source.name}
							</span>
							<span className="text-xs text-text-muted">{source.pluginName ?? ""}</span>
							<span className="grid h-5 min-w-5 place-items-center rounded-pill bg-surface-2 px-1.5 text-xs text-text-muted tabular-nums">
								{source.isHidden ? "–" : (counts.get(source.sourceKey) ?? 0)}
							</span>
						</button>
					);
				})}
			</div>
			<p className="text-xs text-text-muted">
				{hidden === 0
					? "Showing every source from your installed plugins."
					: `${hidden} ${hidden === 1 ? "source" : "sources"} hidden · saved to your account, so it stays hidden on every device.`}
			</p>
		</section>
	);
}

function MonthGrid({
	month,
	today,
	byDay,
	compact,
	onShowDay,
}: {
	readonly month: string;
	readonly today: string;
	readonly compact: boolean;
	readonly onShowDay: (day: string) => void;
	readonly byDay: ReadonlyMap<string, readonly Entry[]>;
}) {
	const { year, index } = monthParts(month);
	const offset = (new Date(year, index - 1, 1).getDay() + 6) % 7;
	const length = new Date(year, index, 0).getDate();
	const weeks = Array.from({ length: Math.ceil((offset + length) / 7) }, (_row, week) =>
		Array.from(
			{ length: 7 },
			(_cell, weekday) => new Date(year, index - 1, 1 - offset + week * 7 + weekday),
		),
	);
	const dayNumber = (date: Date, day: string, inMonth: boolean) => (
		<span
			className={clsx(
				"grid h-6 min-w-6 place-items-center self-start rounded-pill px-1 text-[13px]",
				day === today && "bg-accent font-semibold text-accent-ink",
				day !== today && (inMonth ? "text-text" : "text-text-subtle"),
			)}
		>
			{date.getDate()}
		</span>
	);
	return (
		<div className={clsx(!compact && "overflow-x-auto")}>
			<div
				role="grid"
				aria-label={monthLabel(month)}
				className={clsx(
					"overflow-hidden rounded-lg border border-border bg-surface",
					!compact && "min-w-[760px]",
				)}
			>
				<div role="row" className="grid grid-cols-7 border-b border-border">
					{weekdayHeaders.map((label) => (
						<div
							key={label}
							role="columnheader"
							className={clsx(
								"py-2 text-xs font-medium text-text-muted",
								compact ? "px-1 text-center" : "px-2.5",
							)}
						>
							{label}
						</div>
					))}
				</div>
				{weeks.map((dates) => (
					<div
						role="row"
						key={localDay(dates[0] ?? new Date(year, index - 1, 1))}
						className="grid grid-cols-7 border-b border-border last:border-b-0"
					>
						{dates.map((date) => {
							const day = localDay(date);
							const inMonth = date.getMonth() === index - 1;
							const entries = inMonth ? (byDay.get(day) ?? []) : [];
							const hidden = entries.length - MONTH_CELL_ITEMS;
							const visible = entries.slice(0, MONTH_CELL_ITEMS);
							if (compact) {
								return (
									<div
										key={day}
										data-day={day}
										role="gridcell"
										className={clsx(
											"min-w-0 border-r border-border last:border-r-0",
											!inMonth && "bg-surface-2",
										)}
									>
										{inMonth ? (
											<button
												type="button"
												onClick={() => onShowDay(day)}
												aria-label={cellLabel(day, entries.length)}
												className={clsx(
													"flex min-h-14 w-full flex-col items-center gap-1 py-1.5 hover:bg-hover",
													day < today && "opacity-70",
												)}
											>
												{dayNumber(date, day, inMonth)}
												<span aria-hidden="true" className="flex items-center gap-0.5">
													{visible.map((entry) => (
														<SourceDot key={entry.key} size="size-1.5" color={entry.color} />
													))}
												</span>
												{hidden > 0 && (
													<span
														aria-hidden="true"
														className="text-[10px] leading-none text-text-muted"
													>
														+{hidden}
													</span>
												)}
											</button>
										) : (
											<div className="flex min-h-14 justify-center py-1.5">
												{dayNumber(date, day, inMonth)}
											</div>
										)}
									</div>
								);
							}
							return (
								<div
									key={day}
									data-day={day}
									role="gridcell"
									className={clsx(
										"flex min-h-33 flex-col gap-0.5 border-r border-border p-1.5 last:border-r-0",
										!inMonth && "bg-surface-2",
									)}
								>
									{dayNumber(date, day, inMonth)}
									{visible.map((entry) => (
										<PluginLink
											key={entry.key}
											to={{ kind: "entity", entityId: entry.occurrence.subject.id }}
											className={clsx(
												"flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs text-text hover:bg-hover",
												day < today && "opacity-70",
											)}
										>
											<SourceDot size="size-1.5" color={entry.color} />
											{entry.occurrence.precision === "instant" && (
												<span className="shrink-0 text-text-muted tabular-nums">
													{timeLabel(entry.occurrence)}
												</span>
											)}
											<span className="truncate">
												{entry.occurrence.caption === null
													? entry.occurrence.subject.name
													: `${entry.occurrence.subject.name} · ${entry.occurrence.caption}`}
											</span>
										</PluginLink>
									))}
									{hidden > 0 && (
										<Button
											size="sm"
											variant="ghost"
											className="self-start"
											onClick={() => onShowDay(day)}
										>
											+{hidden} more
										</Button>
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}
