import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
	EntityResults,
	usePageContext,
	usePageRefresh,
	usePageShortcut,
	usePluginLocation,
	useRyotViewport,
} from "@ryot-app/client-sdk/plugin";
import {
	ManagedAssetProvider,
	createRyotQuery,
	useEntityRefresh,
	useRyot,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import {
	Badge,
	Button,
	Modal,
	ScreenBarButton,
	SearchField,
	SegmentedControl,
	Select,
	StatusMessage,
} from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { SyncCountLine } from "@ryot-app/client-ui-sdk/sync";
import {
	EntityBrowserPageInput,
	entityBrowserCountRecipe,
	entityBrowserRecipe,
	type EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import clsx from "clsx";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";

import {
	BrowserEmpty,
	BrowserInlineError,
	BrowserNoMatches,
	BrowserPagination,
	BrowserSearching,
} from "./browser-states";
import { BrowserTable } from "./browser-table";
import { managedCellAssets } from "./display-value";

type BrowserLayout = "grid" | "list" | "table";
type BrowserControls = {
	readonly sort: string;
	readonly search: string;
	readonly layout: BrowserLayout;
};
type BrowserPage = { readonly input: string; readonly result: EntityBrowserResult };
type BrowserState = {
	readonly depth: number;
	readonly identity: string;
	readonly items: EntityBrowserResult["items"];
	readonly pageInfo: EntityBrowserResult["pageInfo"] | null;
};
type RefreshReplay = {
	readonly identity: string;
	readonly generation: number;
	readonly targetDepth: number;
	readonly complete: () => void;
	readonly pages: readonly EntityBrowserResult[];
};

const MAX_TABLE_INTEREST = 500;

const normalizeSearch = (search: string) =>
	search
		.trim()
		.split(/[\s_-]+/)
		.filter(Boolean)
		.join(" ");

const QueryInput = Schema.Tuple([
	Schema.String,
	Schema.String,
	Schema.NullOr(Schema.String),
	Schema.Number,
]);

const decodeQueryInput = Schema.decodeUnknownSync(Schema.fromJsonString(QueryInput));

const layoutOptions = [
	{ value: "grid", label: "Grid view", content: <AppIcon size={15} name="grid" /> },
	{ value: "list", label: "List view", content: <AppIcon size={15} name="list" /> },
	{ value: "table", label: "Table view", content: <AppIcon size={15} name="table" /> },
] as const;

const resultLabel = (loaded: number, hasMore: boolean, total: number | undefined) => {
	if (hasMore && total !== undefined) {
		return `${loaded.toLocaleString()} of ${total.toLocaleString()} results`;
	}
	return `${loaded.toLocaleString()}${hasMore ? "+" : ""} ${
		loaded === 1 && !hasMore ? "result" : "results"
	}`;
};

const syncSummary = (items: EntityBrowserResult["items"]) => ({
	populating: items.filter(({ sync }) => sync.populationStatus === "pending").length,
	translating: items.filter(({ sync }) => sync.translationStatus === "pending").length,
});

const BrowserCount = ({
	input,
	onTotal,
	searchText,
}: {
	readonly searchText: string;
	readonly input: typeof EntityBrowserPageInput.Type;
	readonly onTotal: (total: number | undefined) => void;
}) => {
	const [query] = useState(() =>
		createRyotQuery<string, number>(({ client, signal, input: search }) =>
			client.data.query(
				Result.getOrThrow(
					entityBrowserCountRecipe(
						input.dataSources,
						input.settings,
						search === "" ? {} : { searchText: search },
					),
				),
				{ signal },
			),
		),
	);
	const result = useRyotQuery(query, searchText);
	const report = useEffectEvent((total: number | undefined) => onTotal(total));
	useEffect(() => report(result.data), [result.data]);
	if (result.isPending) {
		return (
			<Button disabled variant="text" className="text-sm text-accent-text">
				Counting...
			</Button>
		);
	}
	if (result.isError) {
		return (
			<Button variant="text" onClick={result.refetch} className="text-sm text-accent-text">
				Retry count
			</Button>
		);
	}
	return null;
};

const Browser = ({ input }: { readonly input: typeof EntityBrowserPageInput.Type }) => {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const location = usePluginLocation();
	const { compact, safeAreaBottom } = useRyotViewport();
	const viewName = input.view?.name ?? "Entity browser";
	const viewIcon = input.view?.icon ?? "library";
	const params = new URLSearchParams(location.search);
	const requestedLayout = params.get("layout");
	const requestedSort = params.get("sort") ?? "";
	const requestedSearch = params.get("search") ?? "";
	const fallbackLayout = input.settings.layouts.includes(input.settings.defaultLayout)
		? input.settings.defaultLayout
		: input.settings.layouts[0];
	const requestedControls: BrowserControls = {
		search: input.settings.searchFields.length === 0 ? "" : requestedSearch,
		layout:
			input.settings.layouts.find((candidate) => candidate === requestedLayout) ?? fallbackLayout,
		sort: input.settings.sortChoices.some(({ name }) => name === requestedSort)
			? requestedSort
			: "",
	};
	const [controls, setControls] = useState(requestedControls);
	const [draftSearch, setDraftSearch] = useState(requestedControls.search);
	const controlsRef = useRef(controls);
	const pendingSearch = useRef<
		{ readonly identity: string; readonly update: Record<string, string | null> } | undefined
	>(undefined);
	const { layout, sort: sortChoice, search: searchText } = controls;
	const [cursor, setCursor] = useState<string | null>(null);
	const [showCount, setShowCount] = useState(false);
	const [total, setTotal] = useState<number | undefined>(undefined);
	const [searchOpen, setSearchOpen] = useState(false);
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [refreshGeneration, setRefreshGeneration] = useState(0);
	const refreshGenerationRef = useRef(0);
	const searchInput = useRef<HTMLInputElement>(null);
	const searchTrigger = useRef<HTMLButtonElement>(null);
	const optionsTrigger = useRef<HTMLButtonElement>(null);
	const identity = JSON.stringify([input.target.savedViewId, searchText, sortChoice]);
	const [state, setState] = useState<BrowserState>({
		identity,
		depth: 0,
		items: [],
		pageInfo: null,
	});
	const stateRef = useRef(state);
	const appliedPages = useRef(new Set<string>());
	const refreshReplay = useRef<RefreshReplay | undefined>(undefined);
	const activeIdentity = useRef(identity);
	const refresh = useEffectEvent(
		() =>
			new Promise<void>((complete) => {
				refreshReplay.current?.complete();
				const next = ++refreshGenerationRef.current;
				refreshReplay.current = {
					complete,
					identity,
					pages: [],
					generation: next,
					targetDepth: Math.max(
						1,
						stateRef.current.identity === identity ? stateRef.current.depth : 1,
					),
				};
				appliedPages.current.clear();
				setCursor(null);
				setRefreshGeneration(next);
				const pending = pendingSearch.current;
				if (pending) {
					pendingSearch.current = {
						...pending,
						identity: JSON.stringify([
							input.target.savedViewId,
							controlsRef.current.search,
							controlsRef.current.sort,
						]),
					};
				}
			}),
	);
	usePageRefresh(refresh);
	useEffect(() => () => refreshReplay.current?.complete(), []);
	const [query] = useState(() =>
		createRyotQuery<string, BrowserPage>(
			async ({ client, signal, input: serialized }) => {
				const [search, sort, after] = decodeQueryInput(serialized);
				const result = await client.data.query(
					Result.getOrThrow(
						entityBrowserRecipe({
							settings: input.settings,
							queryDocument: input.dataSources,
							...(search === "" ? {} : { searchText: search }),
							...(sort === "" ? {} : { sortChoice: sort }),
							...(after === null ? {} : { after }),
						}),
					),
					{ signal },
				);
				return { result, input: serialized };
			},
			{ cancelOnUnmount: true },
		),
	);
	const queryInput = JSON.stringify([searchText, sortChoice, cursor, refreshGeneration]);
	const result = useRyotQuery(query, queryInput, { refreshOnMutation: false });

	const requestedKey = JSON.stringify([
		requestedControls.layout,
		requestedControls.search,
		requestedControls.sort,
	]);
	const applyRequestedControls = useEffectEvent(() => {
		pendingSearch.current = undefined;
		controlsRef.current = requestedControls;
		setControls(requestedControls);
		setDraftSearch(requestedControls.search);
	});
	useEffect(() => {
		applyRequestedControls();
	}, [requestedKey]);

	useEffect(() => {
		if (activeIdentity.current === identity) {
			return;
		}
		activeIdentity.current = identity;
		refreshReplay.current?.complete();
		refreshReplay.current = undefined;
		appliedPages.current.clear();
		setCursor(null);
		setShowCount(false);
		setTotal(undefined);
		setState({ identity, depth: 0, items: [], pageInfo: null });
	}, [identity]);

	useEffect(() => {
		const page = result.data;
		if (!page || page.input !== queryInput) {
			return;
		}
		const pageKey = page.input;
		if (appliedPages.current.has(pageKey)) {
			return;
		}
		appliedPages.current.add(pageKey);
		const replay = refreshReplay.current;
		if (replay?.identity === identity && replay.generation === refreshGeneration) {
			const pages = [...replay.pages, page.result];
			if (pages.length < replay.targetDepth && page.result.pageInfo.hasMore) {
				refreshReplay.current = { ...replay, pages };
				setCursor(page.result.pageInfo.nextCursor);
				return;
			}
			const items = pages.flatMap(({ items: pageItems }) => pageItems);
			const deduped = [...new Map(items.map((item) => [item.entityId, item])).values()];
			replay.complete();
			refreshReplay.current = undefined;
			setState({ identity, items: deduped, depth: pages.length, pageInfo: page.result.pageInfo });
			return;
		}
		setState((current) => {
			if (current.identity !== identity) {
				return current;
			}
			const seen = new Set(current.items.map(({ entityId }) => entityId));
			const items = [...current.items];
			for (const item of page.result.items) {
				if (!seen.has(item.entityId)) {
					seen.add(item.entityId);
					items.push(item);
				}
			}
			return { items, identity, depth: current.depth + 1, pageInfo: page.result.pageInfo };
		});
	}, [identity, queryInput, refreshGeneration, result.data]);

	useEffect(() => {
		const replay = refreshReplay.current;
		if (
			result.isError &&
			replay?.identity === identity &&
			replay.generation === refreshGeneration
		) {
			replay.complete();
			refreshReplay.current = { ...replay, complete: () => undefined };
		}
	}, [identity, refreshGeneration, result.isError]);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	useEffect(() => {
		const pending = pendingSearch.current;
		if (
			!pending ||
			pending.identity !== identity ||
			state.identity !== identity ||
			state.pageInfo === null
		) {
			return;
		}
		pendingSearch.current = undefined;
		ryot.navigation.pageSearch.replace(pending.update);
	}, [identity, ryot, state.identity, state.pageInfo]);

	const transitioning = state.identity !== identity;
	const current = transitioning ? { items: [], pageInfo: null } : state;
	const initial = current.pageInfo === null;
	const addAction = input.settings.addAction;
	const canAdd = addAction !== null;
	const canSearch = input.settings.searchFields.length > 0;
	const hasItems = current.items.length > 0;
	const layouts = layoutOptions.filter(({ value }) => input.settings.layouts.includes(value));
	const summary = syncSummary(current.items);
	const references = current.items.map((item) => ({
		name: item.name,
		entityId: item.entityId,
		ownerPluginId: item.ownerPluginId,
		entitySchemaSlug: item.entitySchemaSlug,
		...item.sync,
	}));
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
		onRefresh: () => refresh(),
		identity: `${identity}:${layout}`,
		blocked: transitioning || result.isFetching,
	});

	const openAdd = (initialQuery?: string) => {
		if (addAction === null) {
			return;
		}
		ryot.screens.openProviderSearch({
			ownerPluginId: addAction.ownerPluginId,
			entitySchemaSlug: addAction.entitySchemaSlug,
			...(initialQuery === undefined || initialQuery === "" ? {} : { initialQuery }),
		});
	};
	const setQueryControls = (update: Partial<Pick<BrowserControls, "search" | "sort">>) => {
		const next = { ...controlsRef.current, ...update };
		if (next.search === controlsRef.current.search && next.sort === controlsRef.current.sort) {
			return;
		}
		controlsRef.current = next;
		pendingSearch.current = {
			update: { sort: next.sort || null, search: next.search || null },
			identity: JSON.stringify([input.target.savedViewId, next.search, next.sort]),
		};
		setControls(next);
	};
	const commitSearch = useEffectEvent((value: string) =>
		setQueryControls({ search: normalizeSearch(value) }),
	);
	const setSort = (value: string) => setQueryControls({ sort: value });
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
	useEffect(() => schedule.after(300, () => commitSearch(draftSearch)), [draftSearch, schedule]);

	usePageShortcut("A", () => openAdd(), { enabled: canAdd });
	usePageShortcut(
		"/",
		() => {
			if (compact) {
				setSearchOpen(true);
				return;
			}
			searchInput.current?.focus();
		},
		{ enabled: canSearch },
	);

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
			<BrowserInlineError
				onRetry={result.refetch}
				title="Saved view unavailable"
				message="The saved view results could not be loaded."
			/>
		);
	} else if (initial && result.isPending) {
		content = searchText === "" ? null : <BrowserSearching />;
	} else if (!hasItems && searchText !== "") {
		content = (
			<BrowserNoMatches
				canAdd={canAdd}
				name={viewName}
				query={searchText}
				onAdd={() => openAdd(searchText)}
			/>
		);
	} else if (!hasItems) {
		content = <BrowserEmpty canAdd={canAdd} name={viewName} onAdd={() => openAdd()} />;
	} else if (layout === "table") {
		content = (
			<BrowserTable settled={settled} items={current.items} columns={input.settings.tableColumns} />
		);
	} else {
		content = (
			<EntityResults
				layout={layout}
				references={references}
				viewContext={{ savedViewId: input.target.savedViewId }}
			/>
		);
	}

	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				title={viewName}
				titleIcon={<AppIcon size={20} name={viewIcon} className="shrink-0 text-text-muted" />}
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
					compact && canAdd ? (
						<button
							type="button"
							aria-keyshortcuts="A"
							onClick={() => openAdd()}
							aria-label="Add to this view"
							style={{ bottom: Math.max(48, safeAreaBottom + 16) }}
							className="absolute right-8 z-20 flex size-14 items-center justify-center rounded-pill bg-accent shadow-card"
						>
							<AppIcon size={28} name="plus" className="text-accent-ink" />
						</button>
					) : undefined
				}
				barActions={
					<>
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
							label="View options, 0 active filters"
						>
							<AppIcon size={22} name="sliders-horizontal" />
						</ScreenBarButton>
					</>
				}
				meta={
					<div
						role="status"
						className="flex h-10 items-center gap-2 text-xs text-text-muted @2xl:text-sm"
					>
						<span>
							{resultLabel(current.items.length, current.pageInfo?.hasMore ?? false, total)}
						</span>
						{current.pageInfo?.hasMore && !showCount && (
							<Button
								variant="text"
								onClick={() => setShowCount(true)}
								className="text-sm text-accent-text"
							>
								Count all
							</Button>
						)}
						{current.pageInfo?.hasMore && showCount && (
							<BrowserCount
								input={input}
								key={identity}
								onTotal={setTotal}
								searchText={searchText}
							/>
						)}
						<SyncCountLine populating={summary.populating} translating={summary.translating} />
						{transitioning && <span>Updating...</span>}
					</div>
				}
				actions={
					<div className="flex flex-wrap items-center justify-end gap-2.5">
						{canSearch && searchField("h-8.5 w-60")}
						{input.settings.sortChoices.length > 0 && (
							<Select
								className="w-48"
								value={sortChoice}
								onChange={setSort}
								label="Sort results"
								checkIcon={<AppIcon size={14} name="check" />}
								chevronIcon={<AppIcon size={14} name="chevron-down" />}
								choices={[
									{ value: "", label: "Default order" },
									...input.settings.sortChoices.map(({ name, label }) => ({ label, value: name })),
								]}
							/>
						)}
						<SegmentedControl
							value={layout}
							options={layouts}
							onChange={setLayout}
							label="Saved view layout"
						/>
						<button
							type="button"
							disabled={!hasItems}
							aria-disabled="true"
							className={clsx(
								"flex h-8.5 items-center gap-2 rounded-md border border-border-strong bg-bg px-3",
								!hasItems && "opacity-50",
							)}
						>
							<AppIcon size={15} name="sliders-horizontal" className="text-text-muted" />
							<span className="text-[13px] text-text">Filters</span>
							<Badge aria-hidden="true">0</Badge>
						</button>
						{canAdd && (
							<button
								type="button"
								aria-label="Add"
								aria-keyshortcuts="A"
								onClick={() => openAdd()}
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
					{content}
					{!initial && result.isError && (
						<div
							role="alert"
							className="flex items-center justify-center gap-3 text-sm text-danger"
						>
							<span>More results could not be loaded.</span>
							<Button variant="text" className="text-sm" onClick={result.refetch}>
								Retry
							</Button>
						</div>
					)}
					{hasItems && !result.isError && (
						<div className="flex w-full flex-col items-center gap-2.5 py-2 @2xl:py-7">
							<BrowserPagination
								name={viewName}
								loaded={current.items.length}
								isLoading={result.isFetching}
								hasMore={current.pageInfo?.hasMore ?? false}
								onLoadMore={() => {
									const next = current.pageInfo?.nextCursor;
									if (next) {
										setCursor(next);
									}
								}}
							/>
						</div>
					)}
				</section>
			</PluginScreenFrame>
			{optionsOpen && (
				<Modal
					label="View options"
					triggerRef={optionsTrigger}
					closeLabel="Close view options"
					onClose={() => setOptionsOpen(false)}
					containerClassName="items-end justify-center"
					className="w-full rounded-t-xl border-t border-border bg-surface p-5"
				>
					<h2 className="font-display text-lg font-semibold text-text">View options</h2>
					<div className="mt-4 flex items-center justify-between gap-3">
						<span className="text-[15px] text-text">View as</span>
						<SegmentedControl
							value={layout}
							options={layouts}
							label="Saved view layout"
							onChange={(next) => {
								setLayout(next);
								setOptionsOpen(false);
							}}
						/>
					</div>
					<p className="mt-4 text-xs text-text-subtle">Filters are not available yet.</p>
				</Modal>
			)}
		</ManagedAssetProvider>
	);
};

export default function EntityBrowserPage() {
	const page = Schema.decodeUnknownResult(EntityBrowserPageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title="Entity browser">
			<StatusMessage tone="error">This entity browser configuration is invalid.</StatusMessage>
		</PluginScreenFrame>
	) : (
		<Browser input={page.success} />
	);
}
