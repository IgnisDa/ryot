import type { EntitySyncState } from "@ryot-app/contract/modules/entities/schemas";
import type { RowsPageInfo } from "@ryot-app/contract/modules/ryotql/language";
import type { EntityBrowserLayout } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	Button,
	type ItemSelection,
	ScreenBarButton,
	SearchField,
	SegmentedControl,
	Select,
	ShortcutHint,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { isEnrichmentActive, SyncCountLine } from "@ryot-app/plugin-ui-sdk/sync";
import type { BrowseSortChoice } from "@ryot-app/ryotql-recipes/browse";
import {
	activeRuleCount,
	decodeFilterParam,
	encodeFilterParam,
} from "@ryot-app/ryotql-recipes/filters";
import type { Effect } from "effect";
import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import type { RyotClient } from "../client/client";
import {
	activeFiltersPhrase,
	FilterChips,
	FilterRules,
	type ViewFilter,
	type ViewFilterField,
	ViewFiltersSheet,
} from "../filters";
import { usePageShortcut, usePluginLocation, useRyotViewport } from "../navigation/routing";
import {
	normalizeViewSearch,
	PluginScreenFrame,
	ViewFiltersButton,
	viewLayoutOptions,
	viewResultLabel,
} from "../plugin-screen";
import { createRyotQuery, type RyotQuery } from "../queries/definitions";
import { useRyotQuery } from "../queries/hooks";
import { nextPageCursor, paginationItems } from "../queries/pagination";
import { useRyotInfiniteQuery } from "../queries/pagination-hook";
import { useRyot, useRyotSchedule } from "../queries/provider";
import { useEntityRefresh } from "../refresh/entity-hooks";
import type { EntitySettle } from "../refresh/settle";
import { useEntitySelection } from "./selection";
import {
	BrowserSelectionBar,
	type BrowserSelectionInput,
	type BrowserSelectionSource,
} from "./selection-bar";
import {
	type AddAction,
	BrowserEmpty,
	BrowserInlineError,
	BrowserNoMatches,
	BrowserPagination,
	BrowserSearching,
} from "./states";

export type BrowserCountSource = (
	client: RyotClient,
	input: BrowserSelectionInput,
) => Effect.Effect<number, Error>;

export type BrowserQueryInput = BrowserSelectionInput & {
	readonly sortChoice: string;
	readonly cursor: null | string;
};

export type BrowserResultsInput<Page extends BrowserPage> = {
	readonly settled: EntitySettle;
	readonly pages: readonly Page[];
	readonly layout: EntityBrowserLayout;
	readonly controls: BrowserSelectionInput;
	readonly selection: undefined | ItemSelection;
	readonly items: readonly Page["items"][number][];
};

type HeaderAction = { readonly icon: string; readonly label: string; readonly run: () => void };

type BrowserItem = {
	readonly entityId: string;
	readonly name: null | string;
	readonly sync?: undefined | EntitySyncState;
};

type BrowserControls = {
	readonly sort: string;
	readonly search: string;
	readonly layout: EntityBrowserLayout;
	readonly filter: undefined | ViewFilter;
};

type BrowserPage = {
	readonly items: readonly BrowserItem[];
	readonly pageInfo: Partial<typeof RowsPageInfo.Type> &
		Pick<typeof RowsPageInfo.Type, "hasMore" | "nextCursor">;
};

type EntityBrowserControllerProps<Page extends BrowserPage, Failure extends Error> = {
	readonly icon: string;
	readonly name: string;
	readonly errorTitle: string;
	readonly identityKey: string;
	readonly errorMessage: string;
	readonly add?: AddAction | undefined;
	readonly canSearch?: boolean | undefined;
	readonly knownTotal?: number | undefined;
	readonly emptyMessage?: string | undefined;
	readonly defaultLayout: EntityBrowserLayout;
	readonly defaultSortLabel?: string | undefined;
	readonly count?: undefined | BrowserCountSource;
	readonly layouts: readonly EntityBrowserLayout[];
	readonly filterFields: readonly ViewFilterField[];
	readonly sortChoices: readonly BrowseSortChoice[];
	readonly selection?: undefined | BrowserSelectionSource;
	readonly query: RyotQuery<BrowserQueryInput, Page, Failure>;
	readonly headerActions?: undefined | readonly HeaderAction[];
	readonly renderSummary?: undefined | ((loaded: number) => ReactNode);
	readonly renderResults: (input: BrowserResultsInput<Page>) => ReactNode;
	readonly noun?: undefined | { readonly one: string; readonly other: string };
};

const MAX_TABLE_INTEREST = 500;

const syncSummary = (items: readonly BrowserItem[]) => ({
	populating: items.filter(({ sync }) => sync && isEnrichmentActive(sync.populationStatus)).length,
	translating: items.filter(({ sync }) => sync && isEnrichmentActive(sync.translationStatus))
		.length,
});

const browserIdentity = (
	key: string,
	search: string,
	sort: string,
	filter: undefined | ViewFilter,
) => JSON.stringify([key, search, sort, encodeFilterParam(filter)]);

const controlsKey = (controls: BrowserControls) =>
	JSON.stringify([
		controls.layout,
		controls.search,
		controls.sort,
		encodeFilterParam(controls.filter),
	]);

export function EntityBrowserController<Page extends BrowserPage, Failure extends Error>({
	add,
	name,
	icon,
	noun,
	query,
	count,
	selection,
	errorTitle,
	knownTotal,
	sortChoices,
	identityKey,
	errorMessage,
	emptyMessage,
	filterFields,
	renderResults,
	renderSummary,
	defaultLayout,
	headerActions,
	canSearch = true,
	layouts: availableLayouts,
	defaultSortLabel = "Default order",
}: EntityBrowserControllerProps<Page, Failure>) {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const location = usePluginLocation();
	const { compact, safeAreaBottom } = useRyotViewport();
	const params = new URLSearchParams(location.search);
	const requestedLayout = params.get("layout");
	const requestedSort = params.get("sort") ?? "";
	const requestedSearch = params.get("search") ?? "";
	const requestedControls: BrowserControls = {
		search: canSearch ? requestedSearch : "",
		filter: decodeFilterParam(params.get("filters"), filterFields),
		layout: availableLayouts.find((candidate) => candidate === requestedLayout) ?? defaultLayout,
		sort: sortChoices.some(
			({ key }) => requestedSort === `${key}-asc` || requestedSort === `${key}-desc`,
		)
			? requestedSort
			: "",
	};
	const [controls, setControls] = useState(requestedControls);
	const [draftSearch, setDraftSearch] = useState(requestedControls.search);
	const controlsRef = useRef(controls);
	const publishedControls = useRef<BrowserControls[]>([]);
	const pendingSearch = useRef<
		| undefined
		| {
				readonly identity: string;
				readonly controls: BrowserControls;
				readonly update: Record<string, null | string>;
		  }
	>(undefined);
	const { layout, filter, sort: sortChoice, search: searchText } = controls;
	const selectedSort = sortChoices.find(
		({ key }) => sortChoice === `${key}-asc` || sortChoice === `${key}-desc`,
	);
	const ascending = selectedSort !== undefined && sortChoice === `${selectedSort.key}-asc`;
	const directionLabel =
		(ascending ? selectedSort.ascending : selectedSort?.descending) ?? "Default";
	const directionIcon = ascending ? "arrow-up" : "arrow-down";
	const filterCount = activeRuleCount(filter);
	const [showCount, setShowCount] = useState(false);
	const [total, setTotal] = useState<number>();
	const [searchOpen, setSearchOpen] = useState(false);
	const [optionsOpen, setOptionsOpen] = useState(false);
	const searchInput = useRef<HTMLInputElement>(null);
	const searchTrigger = useRef<HTMLButtonElement>(null);
	const optionsTrigger = useRef<HTMLButtonElement>(null);
	const filtersTrigger = useRef<HTMLButtonElement>(null);
	const identity = browserIdentity(identityKey, searchText, sortChoice, filter);
	const result = useRyotInfiniteQuery(
		query,
		{ searchText, sortChoice, identityKey, filter: filter ?? null },
		{
			initialPageParam: null,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, cursor: null | string) => ({
				cursor,
				filter: input.filter,
				searchText: input.searchText,
				sortChoice: input.sortChoice,
			}),
		},
	);
	const selecting = useEntitySelection(
		JSON.stringify([identity, result.pages[0]?.pageInfo.sourceRevisions]),
	);
	const staleCollection = result.stale;
	useValueChange(staleCollection, () => {
		if (staleCollection) {
			selecting.exit();
		}
	});
	const state = useMemo(
		() =>
			result.data === undefined
				? undefined
				: {
						identity,
						pages: result.pages,
						pageInfo: result.data.pageInfo,
						items: paginationItems(
							result.pages,
							(page) => page.items,
							(item) => item.entityId,
						),
					},
		[identity, result.pages, result.data],
	);
	const requestedKey = controlsKey(requestedControls);
	useValueChange(requestedKey, () => {
		const acknowledged = publishedControls.current.findIndex(
			(published) => controlsKey(published) === requestedKey,
		);
		if (acknowledged !== -1) {
			publishedControls.current.splice(0, acknowledged + 1);
			return;
		}
		publishedControls.current = [];
		pendingSearch.current = undefined;
		controlsRef.current = requestedControls;
		setControls(requestedControls);
		setDraftSearch(requestedControls.search);
	});
	useEffect(() => {
		controlsRef.current = controls;
	}, [controls]);

	useValueChange(identity, () => {
		setShowCount(false);
		setTotal(undefined);
	});
	const replacePageSearch = (
		update: Record<string, null | string>,
		next: Partial<BrowserControls>,
	) => {
		const previous = publishedControls.current.at(-1) ?? requestedControls;
		const published = { ...previous, ...next };
		if (controlsKey(published) === controlsKey(previous)) {
			return;
		}
		publishedControls.current.push(published);
		ryot.navigation.pageSearch.replace(update);
	};
	const publishSearch = useEffectEvent(replacePageSearch);
	useEffect(() => {
		const pending = pendingSearch.current;
		if (!pending || pending.identity !== identity || state?.identity !== identity) {
			return;
		}
		pendingSearch.current = undefined;
		publishSearch(pending.update, {
			sort: pending.controls.sort,
			search: pending.controls.search,
			filter: pending.controls.filter,
		});
	}, [identity, state]);

	const unfiltered = searchText === "" && filter === undefined && knownTotal !== undefined;
	const transitioning = state?.identity !== identity;
	const current = transitioning ? { items: [], pages: [], pageInfo: null } : state;
	const initial = current.pageInfo === null;
	const hasMore = current.pageInfo?.hasMore ?? false;
	const hasItems = current.items.length > 0;
	const layouts = viewLayoutOptions.filter(({ value }) => availableLayouts.includes(value));
	const summary = syncSummary(current.items);
	const knownMatching = unfiltered ? knownTotal : total;
	const tableIds =
		layout === "table"
			? current.items
					.slice(0, MAX_TABLE_INTEREST)
					.map(({ entityId }) => entityId)
					.join("\u0000")
			: "";
	const tableInterest = useMemo(
		() => ({ foreground: [], visible: tableIds === "" ? [] : tableIds.split("\u0000") }),
		[tableIds],
	);
	const { settled } = useEntityRefresh({
		interest: tableInterest,
		onRefresh: result.refresh,
		identity: `${identity}:${layout}`,
		blocked: transitioning || result.isFetching,
	});

	const setQueryControls = (
		update: Partial<Pick<BrowserControls, "sort" | "search" | "filter">>,
	) => {
		const next = { ...controlsRef.current, ...update };
		const nextIdentity = browserIdentity(identityKey, next.search, next.sort, next.filter);
		if (
			nextIdentity ===
			browserIdentity(
				identityKey,
				controlsRef.current.search,
				controlsRef.current.sort,
				controlsRef.current.filter,
			)
		) {
			return;
		}
		controlsRef.current = next;
		pendingSearch.current = {
			controls: next,
			identity: nextIdentity,
			update: {
				sort: next.sort || null,
				search: next.search || null,
				filters: encodeFilterParam(next.filter),
			},
		};
		setControls(next);
	};
	const setFilter = (next: undefined | ViewFilter) => setQueryControls({ filter: next });
	const commitSearch = (value: string) => setQueryControls({ search: normalizeViewSearch(value) });
	const commitDraftSearch = useEffectEvent((value: string) => commitSearch(value));
	const setLayout = (value: string) => {
		if (value !== "grid" && value !== "list" && value !== "table") {
			return;
		}
		const next: BrowserControls = { ...controlsRef.current, layout: value };
		controlsRef.current = next;
		setControls(next);
		replacePageSearch({ layout: value }, { layout: value });
	};
	const closeSearch = () => {
		setSearchOpen(false);
		searchTrigger.current?.focus();
	};
	useEffect(
		() => schedule.after(300, () => commitDraftSearch(draftSearch)),
		[draftSearch, schedule],
	);
	const selectionActive = !staleCollection && selecting.selection !== null;
	usePageShortcut("A", () => add?.open(), { enabled: add !== undefined && !selectionActive });
	usePageShortcut("/", () => (compact ? setSearchOpen(true) : searchInput.current?.focus()), {
		enabled: canSearch,
	});

	const itemSelection: undefined | ItemSelection = selectionActive
		? { toggle: selecting.toggle, isSelected: selecting.isSelected }
		: undefined;
	const screenActions: readonly HeaderAction[] = [
		...(headerActions ?? []),
		...(selection !== undefined && hasItems && !selectionActive && !staleCollection
			? [{ label: "Select", icon: "circle-check", run: selecting.start }]
			: []),
	];

	const searchField = (className: string, autoFocus = false) => (
		<SearchField
			shortcut="/"
			value={draftSearch}
			className={className}
			autoFocus={autoFocus}
			inputRef={searchInput}
			label={`Search ${name}`}
			onChange={setDraftSearch}
			icon={<AppIcon size={15} name="search" />}
			clearIcon={<AppIcon name="x" size={14} />}
			onSubmit={() => commitSearch(draftSearch)}
		/>
	);
	let content: ReactNode;
	if (initial && result.isError) {
		content = (
			<BrowserInlineError title={errorTitle} message={errorMessage} onRetry={result.refetch} />
		);
	} else if (initial && result.isPending) {
		content = searchText === "" ? null : <BrowserSearching />;
	} else if (!hasItems && (searchText !== "" || filter !== undefined)) {
		content = (
			<BrowserNoMatches
				add={add}
				name={name}
				query={searchText}
				filtered={filter !== undefined}
				onClearFilters={() => setFilter(undefined)}
			/>
		);
	} else if (!hasItems) {
		content = <BrowserEmpty add={add} name={name} message={emptyMessage} />;
	} else {
		content = renderResults({
			layout,
			settled,
			items: current.items,
			pages: current.pages,
			selection: itemSelection,
			controls: { searchText, filter: filter ?? null },
		});
	}

	let floatingAction: ReactNode;
	if (!staleCollection && selecting.selection !== null && selection !== undefined) {
		floatingAction = (
			<BrowserSelectionBar
				key={identity}
				hasMore={hasMore}
				source={selection}
				selecting={selecting}
				knownMatching={knownMatching}
				selection={selecting.selection}
				safeAreaBottom={safeAreaBottom}
				onSelectMatching={() => setShowCount(true)}
				controls={{ searchText, filter: filter ?? null }}
				loadedIds={current.items.map(({ entityId }) => entityId)}
			/>
		);
	} else if (compact && add) {
		floatingAction = (
			<button
				type="button"
				aria-keyshortcuts="A"
				aria-label={add.label}
				onClick={() => add.open()}
				style={{ bottom: Math.max(48, safeAreaBottom + 16) }}
				className="absolute right-8 z-20 flex size-14 items-center justify-center rounded-pill bg-accent shadow-card"
			>
				<AppIcon size={28} name="plus" className="text-accent-ink" />
			</button>
		);
	}

	return (
		<>
			<PluginScreenFrame
				title={name}
				floatingAction={floatingAction}
				titleIcon={<AppIcon size={20} name={icon} className="shrink-0 text-text-muted" />}
				searchRow={
					searchOpen && canSearch ? (
						<>
							<ScreenBarButton label="Exit search" onClick={closeSearch} className="text-text">
								<AppIcon size={22} name="chevron-left" />
							</ScreenBarButton>
							{searchField("h-9.5 flex-1", true)}
						</>
					) : undefined
				}
				barActions={
					<>
						{screenActions.map((action) => (
							<ScreenBarButton
								key={action.label}
								label={action.label}
								onClick={action.run}
								className="text-text-muted"
							>
								<AppIcon size={22} name={action.icon} />
							</ScreenBarButton>
						))}
						{canSearch && (
							<ScreenBarButton
								ref={searchTrigger}
								label="Search this view"
								className="text-text-muted"
								onClick={() => setSearchOpen(true)}
							>
								<AppIcon size={22} name="search" />
							</ScreenBarButton>
						)}
						<ScreenBarButton
							ref={optionsTrigger}
							className="text-text-muted"
							onClick={() => setOptionsOpen(true)}
							label={`View options, ${activeFiltersPhrase(filterCount)}`}
						>
							<AppIcon size={22} name="sliders-horizontal" />
						</ScreenBarButton>
					</>
				}
				meta={
					<>
						<div
							role="status"
							className="flex h-10 items-center gap-2 text-xs text-text-muted @2xl:text-sm"
						>
							<span>
								{viewResultLabel({
									noun,
									hasMore,
									total: knownMatching,
									loaded: current.items.length,
								})}
							</span>
							{hasMore && !unfiltered && !showCount && count && (
								<Button variant="link" onClick={() => setShowCount(true)}>
									Count all
								</Button>
							)}
							{hasMore && !unfiltered && showCount && count && (
								<BrowserCount
									count={count}
									key={identity}
									onTotal={setTotal}
									input={{ searchText, filter: filter ?? null }}
								/>
							)}
							<SyncCountLine populating={summary.populating} translating={summary.translating} />
							{transitioning && <span>Updating...</span>}
						</div>
						<FilterChips
							filter={filter}
							onChange={setFilter}
							fields={filterFields}
							onOpen={() => setOptionsOpen(true)}
						/>
					</>
				}
				actions={
					<div className="flex flex-wrap items-center justify-end gap-2.5">
						{canSearch && searchField("h-8.5 w-60")}
						<SegmentedControl
							value={layout}
							options={layouts}
							onChange={setLayout}
							label={`${name} layout`}
						/>
						<ViewFiltersButton
							ref={filtersTrigger}
							activeCount={filterCount}
							onClick={() => setOptionsOpen(true)}
						/>
						{screenActions.map((action) => (
							<Button key={action.label} variant="secondary" onClick={action.run}>
								<AppIcon size={15} name={action.icon} />
								{action.label}
							</Button>
						))}
						{add && (
							<button
								type="button"
								aria-keyshortcuts="A"
								onClick={() => add.open()}
								className="flex h-8.5 items-center gap-2 rounded-md bg-accent px-3.5"
							>
								<AppIcon size={15} name="plus" className="text-accent-ink" />
								<span className="text-[13px] font-semibold text-accent-ink">{add.label}</span>
								<ShortcutHint onAccent shortcut="A" className="ml-1" />
							</button>
						)}
					</div>
				}
			>
				<section
					aria-busy={result.isFetching}
					className="@container grid w-full content-start gap-5"
				>
					{renderSummary?.(current.items.length)}
					{content}
					{!initial && result.isError && (
						<div
							role="alert"
							className="flex items-center justify-center gap-3 text-sm text-danger"
						>
							<span>
								{staleCollection
									? "This collection changed. Reload to continue."
									: "More results could not be loaded."}
							</span>
							<Button
								variant="ghost"
								className="text-sm"
								onClick={staleCollection ? result.refetch : result.retry}
							>
								{staleCollection ? "Reload collection" : "Retry"}
							</Button>
						</div>
					)}
					{hasItems && !result.isError && (
						<div className="flex w-full flex-col items-center gap-2.5 py-2 @2xl:py-7">
							<BrowserPagination
								name={name}
								disabled={result.isFetching}
								hasMore={result.hasNextPage}
								loaded={current.items.length}
								onLoadMore={result.fetchNextPage}
								isFetchingNextPage={result.isFetchingNextPage}
							/>
						</div>
					)}
				</section>
			</PluginScreenFrame>
			{optionsOpen && (
				<ViewFiltersSheet
					compact={compact}
					onClose={() => setOptionsOpen(false)}
					title={compact ? "View options" : "Filters"}
					triggerRef={compact ? optionsTrigger : filtersTrigger}
				>
					{compact && (
						<div className="mt-4 flex items-center justify-between gap-3">
							<span className="text-[15px] text-text">View as</span>
							<SegmentedControl
								value={layout}
								options={layouts}
								label={`${name} layout`}
								onChange={(next) => {
									setLayout(next);
									setOptionsOpen(false);
								}}
							/>
						</div>
					)}
					{sortChoices.length > 0 && (
						<div className="mt-4 flex flex-wrap items-center gap-2">
							<div className="min-w-0 flex-1 basis-48">
								<Select
									label="Sort by"
									value={selectedSort?.key ?? ""}
									checkIcon={<AppIcon size={14} name="check" />}
									chevronIcon={<AppIcon size={14} name="chevron-down" />}
									choices={[
										{ value: "", label: defaultSortLabel },
										...sortChoices.map(({ key, label }) => ({ label, value: key })),
									]}
									onChange={(key) => {
										if (key === (selectedSort?.key ?? "")) {
											return;
										}
										const choice = sortChoices.find((candidate) => candidate.key === key);
										setQueryControls({
											sort: choice ? `${choice.key}-${choice.defaultDirection}` : "",
										});
									}}
								/>
							</div>
							<Button
								type="button"
								variant="outline"
								disabled={selectedSort === undefined}
								aria-label={`Sort direction: ${directionLabel}`}
								onClick={() => {
									if (selectedSort) {
										setQueryControls({ sort: `${selectedSort.key}-${ascending ? "desc" : "asc"}` });
									}
								}}
							>
								<AppIcon size={14} name={selectedSort ? directionIcon : "arrow-up-down"} />
								{directionLabel}
							</Button>
						</div>
					)}
					<FilterRules
						filter={filter}
						compact={compact}
						onChange={setFilter}
						fields={filterFields}
					/>
				</ViewFiltersSheet>
			)}
		</>
	);
}

function BrowserCount({
	input,
	count,
	onTotal,
}: {
	readonly count: BrowserCountSource;
	readonly input: BrowserSelectionInput;
	readonly onTotal: (total: number | undefined) => void;
}) {
	const [query] = useState(() =>
		createRyotQuery<BrowserSelectionInput, number, Error>(({ client, input: selection }) =>
			count(client, selection),
		),
	);
	const result = useRyotQuery(query, input);
	const report = useEffectEvent((total: number | undefined) => onTotal(total));
	useEffect(() => report(result.data), [result.data]);
	if (result.isPending) {
		return (
			<Button disabled variant="link">
				Counting...
			</Button>
		);
	}
	if (result.isError) {
		return (
			<Button variant="link" onClick={result.refetch}>
				Retry count
			</Button>
		);
	}
	return null;
}
