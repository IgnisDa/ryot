import {
	activeFiltersPhrase,
	FilterChips,
	FilterRules,
	ViewFiltersSheet,
	type ViewFilter,
	type ViewFilterField,
} from "@ryot-app/plugin-client-sdk/filters";
import {
	EntityResults,
	usePageShortcut,
	usePluginLocation,
	useRyotViewport,
	type EntityBrowserLayout,
	type EntityReference,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	ManagedAssetProvider,
	useEntityRefresh,
	useRyot,
	useRyotInfiniteQuery,
	nextPageCursor,
	paginationItems,
	useRyotSchedule,
	type RyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	normalizeViewSearch,
	PluginScreenFrame,
	ViewFiltersButton,
	viewLayoutOptions,
	viewResultLabel,
} from "@ryot-app/plugin-client-sdk/screen";
import {
	Badge,
	Button,
	ScreenBarButton,
	SearchField,
	SegmentedControl,
	Select,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { SyncCountLine } from "@ryot-app/plugin-ui-sdk/sync";
import {
	activeRuleCount,
	decodeFilterParam,
	encodeFilterParam,
} from "@ryot-app/ryotql-recipes/filters";
import type {
	EntityBrowserResultItem,
	SavedViewResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import {
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
	type ComponentProps,
	type ReactNode,
} from "react";

import {
	BrowserEmpty,
	BrowserInlineError,
	BrowserNoMatches,
	BrowserPagination,
	BrowserSearching,
} from "./browser-states";
import { BrowserTable, type BrowserColumns, type BrowserItemActions } from "./browser-table";
import { managedCellAssets } from "./display-value";

export type BrowserResult = SavedViewResult<EntityBrowserResultItem>;
export type BrowserQueryPage<Meta> = { readonly result: BrowserResult; readonly meta: Meta };

type BrowserControls = {
	readonly sort: string;
	readonly filter: ViewFilter | undefined;
	readonly search: string;
	readonly layout: EntityBrowserLayout;
};

export type BrowserSortChoice = { readonly label: string; readonly value: string };

export type AddAction = { readonly label: string; readonly open: (initialQuery?: string) => void };

type HeaderAction = { readonly label: string; readonly icon: string; readonly run: () => void };

export type BrowserResultsRenderer = (input: {
	readonly layout: Exclude<EntityBrowserLayout, "table">;
	readonly references: readonly EntityReference[];
	readonly items: BrowserResult["items"];
}) => ReactNode;

type EntityBrowserControllerProps<Meta> = {
	readonly add?: AddAction | undefined;
	readonly canSearch?: boolean | undefined;
	readonly count?:
		| ((input: {
				readonly searchText: string;
				readonly filter: ViewFilter | undefined;
				readonly onTotal: (total: number | undefined) => void;
		  }) => ReactNode)
		| undefined;
	readonly filterFields: readonly ViewFilterField[];
	readonly defaultLayout: EntityBrowserLayout;
	readonly defaultSortLabel?: string | undefined;
	readonly emptyMessage?: string | undefined;
	readonly headerAction?: HeaderAction | undefined;
	readonly renderItemActions?: BrowserItemActions | undefined;
	readonly errorMessage: string;
	readonly errorTitle: string;
	readonly icon: string;
	readonly identityKey: string;
	readonly knownTotal?: number | undefined;
	readonly layouts: readonly EntityBrowserLayout[];
	readonly name: (meta: Meta | undefined) => string;
	readonly query: RyotQuery<string, BrowserQueryPage<Meta>>;
	readonly renderResults?: BrowserResultsRenderer | undefined;
	readonly renderSummary?: ((meta: Meta, loaded: number) => ReactNode) | undefined;
	readonly sortChoices: readonly BrowserSortChoice[];
	readonly tableColumns: BrowserColumns | null | ((meta: Meta | undefined) => BrowserColumns);
	readonly viewContext: ComponentProps<typeof EntityResults>["viewContext"];
};

const MAX_TABLE_INTEREST = 500;
const syncSummary = (items: BrowserResult["items"]) => ({
	populating: items.filter(({ sync }) => sync.populationStatus === "pending").length,
	translating: items.filter(({ sync }) => sync.translationStatus === "pending").length,
});

const browserIdentity = (
	key: string,
	search: string,
	sort: string,
	filter: ViewFilter | undefined,
) => JSON.stringify([key, search, sort, encodeFilterParam(filter)]);

export function EntityBrowserController<Meta>({
	add,
	name,
	icon,
	query,
	count,
	errorTitle,
	knownTotal,
	viewContext,
	sortChoices,
	identityKey,
	tableColumns,
	errorMessage,
	emptyMessage,
	headerAction,
	filterFields,
	renderResults,
	renderSummary,
	defaultLayout,
	canSearch = true,
	renderItemActions,
	layouts: availableLayouts,
	defaultSortLabel = "Default order",
}: EntityBrowserControllerProps<Meta>) {
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
		sort: sortChoices.some(({ value }) => value === requestedSort) ? requestedSort : "",
		layout: availableLayouts.find((candidate) => candidate === requestedLayout) ?? defaultLayout,
	};
	const [controls, setControls] = useState(requestedControls);
	const [draftSearch, setDraftSearch] = useState(requestedControls.search);
	const controlsRef = useRef(controls);
	const pendingSearch = useRef<
		| {
				readonly identity: string;
				readonly requestedKey: string;
				readonly update: Record<string, string | null>;
		  }
		| undefined
	>(undefined);
	const { layout, filter, sort: sortChoice, search: searchText } = controls;
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
			getNextPageParam: (page) => nextPageCursor(page.result),
			getPageInput: (selection, cursor: string | null) =>
				JSON.stringify({
					cursor,
					filter: selection.filter,
					searchText: selection.searchText,
					sortChoice: selection.sortChoice,
				}),
		},
	);
	const state = useMemo(
		() =>
			result.data === undefined
				? undefined
				: {
						identity,
						meta: result.data.meta,
						pageInfo: result.data.result.pageInfo,
						items: paginationItems(
							result.pages,
							(page) => page.result.items,
							(item) => item.entityId,
						),
					},
		[identity, result.pages, result.data],
	);
	const requestedKey = JSON.stringify([
		requestedControls.layout,
		requestedControls.search,
		requestedControls.sort,
		encodeFilterParam(requestedControls.filter),
	]);
	useValueChange(requestedKey, () => {
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
	useEffect(() => {
		const pending = pendingSearch.current;
		if (pending?.requestedKey !== undefined && pending.requestedKey !== requestedKey) {
			pendingSearch.current = undefined;
			return;
		}
		if (!pending || pending.identity !== identity || state?.identity !== identity) {
			return;
		}
		pendingSearch.current = undefined;
		ryot.navigation.pageSearch.replace(pending.update);
	}, [identity, requestedKey, ryot, state]);

	const unfiltered = searchText === "" && filter === undefined && knownTotal !== undefined;
	const transitioning = state?.identity !== identity;
	const current = transitioning ? { items: [], pageInfo: null, meta: undefined } : state;
	const initial = current.pageInfo === null;
	const viewName = name(current.meta);
	const hasItems = current.items.length > 0;
	const layouts = viewLayoutOptions.filter(({ value }) => availableLayouts.includes(value));
	const summary = syncSummary(current.items);
	const columns = typeof tableColumns === "function" ? tableColumns(current.meta) : tableColumns;
	const references = current.items.map((item) => ({
		name: item.name,
		entityId: item.entityId,
		ownerPluginId: item.ownerPluginId,
		entitySchemaSlug: item.entitySchemaSlug,
		...item.sync,
	}));
	const presentations = new Map(
		current.items.flatMap(({ entityId, presentation }) =>
			presentation === null ? [] : [[entityId, presentation] as const],
		),
	);
	const assets = current.items.flatMap((item) => managedCellAssets(item.cells));
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
		update: Partial<Pick<BrowserControls, "search" | "sort" | "filter">>,
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
			requestedKey,
			identity: nextIdentity,
			update: {
				sort: next.sort || null,
				search: next.search || null,
				filters: encodeFilterParam(next.filter),
			},
		};
		setControls(next);
	};
	const setFilter = (next: ViewFilter | undefined) => setQueryControls({ filter: next });
	const commitSearch = (value: string) => setQueryControls({ search: normalizeViewSearch(value) });
	const commitDraftSearch = useEffectEvent((value: string) => commitSearch(value));
	const setLayout = (value: string) => {
		if (value !== "grid" && value !== "list" && value !== "table") {
			return;
		}
		const next: BrowserControls = { ...controlsRef.current, layout: value };
		controlsRef.current = next;
		setControls(next);
		ryot.navigation.pageSearch.replace({ layout: value });
	};
	const closeSearch = () => {
		setSearchOpen(false);
		searchTrigger.current?.focus();
	};
	useEffect(
		() => schedule.after(300, () => commitDraftSearch(draftSearch)),
		[draftSearch, schedule],
	);
	usePageShortcut("A", () => add?.open(), { enabled: add !== undefined });
	usePageShortcut("/", () => (compact ? setSearchOpen(true) : searchInput.current?.focus()), {
		enabled: canSearch,
	});

	const searchField = (className: string, autoFocus = false) => (
		<SearchField
			shortcut="/"
			value={draftSearch}
			className={className}
			autoFocus={autoFocus}
			inputRef={searchInput}
			onChange={setDraftSearch}
			label={`Search ${viewName}`}
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
				name={viewName}
				query={searchText}
				canAdd={add !== undefined}
				filtered={filter !== undefined}
				onAdd={() => add?.open(searchText)}
				onClearFilters={() => setFilter(undefined)}
			/>
		);
	} else if (!hasItems) {
		content = (
			<BrowserEmpty
				name={viewName}
				message={emptyMessage}
				onAdd={() => add?.open()}
				canAdd={add !== undefined}
			/>
		);
	} else if (layout === "table") {
		content = (
			<BrowserTable
				settled={settled}
				columns={columns}
				items={current.items}
				renderItemActions={renderItemActions}
			/>
		);
	} else {
		content = renderResults?.({ layout, references, items: current.items }) ?? (
			<EntityResults
				layout={layout}
				references={references}
				viewContext={viewContext}
				presentations={presentations}
				renderItemActions={renderItemActions}
			/>
		);
	}

	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				title={viewName}
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
				floatingAction={
					compact && add ? (
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
					) : undefined
				}
				barActions={
					<>
						{headerAction && (
							<ScreenBarButton
								label={headerAction.label}
								onClick={headerAction.run}
								className="text-text-muted"
							>
								<AppIcon size={22} name={headerAction.icon} />
							</ScreenBarButton>
						)}
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
									loaded: current.items.length,
									total: unfiltered ? knownTotal : total,
									hasMore: current.pageInfo?.hasMore ?? false,
								})}
							</span>
							{current.pageInfo?.hasMore && !unfiltered && !showCount && count && (
								<Button
									variant="ghost"
									onClick={() => setShowCount(true)}
									className="text-sm text-accent-text"
								>
									Count all
								</Button>
							)}
							{current.pageInfo?.hasMore &&
								!unfiltered &&
								showCount &&
								count?.({ filter, searchText, onTotal: setTotal })}
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
							label={`${viewName} layout`}
						/>
						<ViewFiltersButton
							ref={filtersTrigger}
							activeCount={filterCount}
							onClick={() => setOptionsOpen(true)}
						/>
						{headerAction && (
							<Button variant="secondary" onClick={headerAction.run}>
								<AppIcon size={15} name={headerAction.icon} />
								{headerAction.label}
							</Button>
						)}
						{add && (
							<button
								type="button"
								aria-label="Add"
								aria-keyshortcuts="A"
								onClick={() => add.open()}
								className="flex h-8.5 items-center gap-2 rounded-md bg-accent px-3.5"
							>
								<AppIcon size={15} name="plus" className="text-accent-ink" />
								<span className="text-[13px] font-semibold text-accent-ink">Add</span>
								<Badge className="ml-1" aria-hidden="true" variant="keyOnAccent">
									A
								</Badge>
							</button>
						)}
					</div>
				}
			>
				<section
					aria-busy={result.isFetching}
					className="@container grid w-full content-start gap-5"
				>
					{current.meta !== undefined && renderSummary?.(current.meta, current.items.length)}
					{content}
					{!initial && result.isError && (
						<div
							role="alert"
							className="flex items-center justify-center gap-3 text-sm text-danger"
						>
							<span>More results could not be loaded.</span>
							<Button variant="ghost" className="text-sm" onClick={result.retry}>
								Retry
							</Button>
						</div>
					)}
					{hasItems && !result.isError && (
						<div className="flex w-full flex-col items-center gap-2.5 py-2 @2xl:py-7">
							<BrowserPagination
								name={viewName}
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
								label={`${viewName} layout`}
								onChange={(next) => {
									setLayout(next);
									setOptionsOpen(false);
								}}
							/>
						</div>
					)}
					{sortChoices.length > 0 && (
						<div className="mt-4">
							<Select
								className="w-full"
								value={sortChoice}
								label="Sort results"
								checkIcon={<AppIcon size={14} name="check" />}
								onChange={(value) => setQueryControls({ sort: value })}
								chevronIcon={<AppIcon size={14} name="chevron-down" />}
								choices={[{ value: "", label: defaultSortLabel }, ...sortChoices]}
							/>
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
		</ManagedAssetProvider>
	);
}
