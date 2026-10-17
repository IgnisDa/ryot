import { DateTime, Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	PluginLink,
	usePageContext,
	usePluginLocation,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	ManagedAssetProvider,
	createRyotQuery,
	useRyot,
	useRyotInfiniteQuery,
	nextPageCursor,
	paginationItems,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame, ViewFiltersButton } from "@ryot-app/plugin-client-sdk/screen";
import {
	Button,
	LoadMoreButton,
	Modal,
	ScreenBarButton,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import {
	activeRuleCount,
	decodeFilterParam,
	effectiveFilterFields,
	encodeFilterParam,
	NullableFilter,
} from "@ryot-app/ryotql-recipes/saved-view-filters";
import {
	ResultsTablePageInput,
	resultsTableRecipe,
	type ResultsTableResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useRef, useState } from "react";

import { FilterChips, FilterRules, type BrowserFilter } from "./browser-filters";
import { BrowserNoMatches } from "./browser-states";
import { CellValue, cellText, managedCellAssets } from "./display-value";

const QueryInput = Schema.Struct({ filter: NullableFilter, after: Schema.NullOr(Schema.String) });
const decodeQueryInput = Schema.decodeUnknownSync(Schema.fromJsonString(QueryInput));

type TableItem = ResultsTableResult["items"][number];

const rowLabel = (item: TableItem) => {
	const text = item.cells.find(({ value }) => value.displayKind === "text");
	return text === undefined ? "" : cellText(text.value);
};

const resultsTableColumns = (
	declared: (typeof ResultsTablePageInput.Type)["settings"]["columns"],
): readonly DataTableColumn<TableItem>[] =>
	declared.map((column, index) => ({
		id: column.field,
		header: column.label,
		cell: (item: TableItem) => {
			const value = item.cells.find(({ key }) => key === column.field)?.value;
			const content =
				value === undefined ? null : <CellValue value={value} monogram={rowLabel(item)} />;
			return index === 0 && item.entityId !== undefined ? (
				<PluginLink to={{ kind: "entity", entityId: item.entityId }}>{content}</PluginLink>
			) : (
				content
			);
		},
	}));

const ResultsTable = ({ input }: { readonly input: typeof ResultsTablePageInput.Type }) => {
	const viewName = input.view?.name ?? "Results table";
	const viewIcon = input.view?.icon ?? "table";
	const ryot = useRyot();
	const location = usePluginLocation();
	const { compact } = useRyotViewport();
	const [filtersOpen, setFiltersOpen] = useState(false);
	const optionsTrigger = useRef<HTMLButtonElement>(null);
	const filtersTrigger = useRef<HTMLButtonElement>(null);
	const filterFields = effectiveFilterFields("results-table", input.settings);
	const filter = decodeFilterParam(
		new URLSearchParams(location.search).get("filters"),
		filterFields,
	);
	const filterCount = activeRuleCount(filter);
	const setFilter = (next: BrowserFilter | undefined) =>
		ryot.navigation.pageSearch.replace({ filters: encodeFilterParam(next) });
	const [query] = useState(() =>
		createRyotQuery<string, ResultsTableResult>(
			({ client, input: serialized }) =>
				Effect.gen(function* () {
					const { after, filter: applied } = decodeQueryInput(serialized);
					const now = yield* DateTime.now;
					return yield* client.data.query(
						Result.getOrThrow(
							resultsTableRecipe({
								settings: input.settings,
								queryDocument: input.dataSources,
								...(after === null ? {} : { after }),
								...(applied === null ? {} : { now, filter: applied }),
							}),
						),
					);
				}),
			{ cancelOnUnmount: true },
		),
	);
	const result = useRyotInfiniteQuery(
		query,
		{ filter: filter ?? null, reference: input.target.reference },
		{
			initialPageParam: null,
			getNextPageParam: nextPageCursor,
			getPageInput: (selection, after: string | null) =>
				JSON.stringify({ after, filter: selection.filter }),
		},
	);
	const state = {
		pageInfo: result.data?.pageInfo ?? null,
		items: paginationItems(
			result.pages,
			(page) => page.items,
			(item) => item.key,
		),
	};

	const initial = state.pageInfo === null;
	const assets = state.items.flatMap((item) => managedCellAssets(item.cells));

	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				title={viewName}
				titleIcon={<AppIcon size={20} name={viewIcon} className="shrink-0 text-text-muted" />}
				actions={
					<ViewFiltersButton
						ref={filtersTrigger}
						activeCount={filterCount}
						onClick={() => setFiltersOpen(true)}
					/>
				}
				barActions={
					<ScreenBarButton
						ref={optionsTrigger}
						className="text-text-muted"
						onClick={() => setFiltersOpen(true)}
						label={`Filters, ${filterCount} active ${filterCount === 1 ? "filter" : "filters"}`}
					>
						<AppIcon size={22} name="sliders-horizontal" />
					</ScreenBarButton>
				}
				meta={
					<>
						<p role="status" className="text-xs text-text-muted @2xl:text-sm">
							{`${state.items.length.toLocaleString()}${
								state.pageInfo?.hasMore ? "+" : ""
							} ${state.items.length === 1 && !state.pageInfo?.hasMore ? "result" : "results"}`}
						</p>
						<FilterChips
							filter={filter}
							onChange={setFilter}
							fields={filterFields}
							onOpen={() => setFiltersOpen(true)}
						/>
					</>
				}
			>
				<section aria-busy={result.isFetching} className="@container grid gap-5">
					{initial && result.isPending && (
						<StatusMessage tone="pending">Loading results...</StatusMessage>
					)}
					{initial && result.isError && (
						<StatusMessage tone="error">
							Results unavailable.{" "}
							<Button variant="ghost" onClick={result.refetch}>
								Retry
							</Button>
						</StatusMessage>
					)}
					{!initial && state.items.length === 0 && filter !== undefined && (
						<BrowserNoMatches
							query=""
							filtered
							canAdd={false}
							name={viewName}
							onAdd={() => undefined}
							onClearFilters={() => setFilter(undefined)}
						/>
					)}
					{!initial && state.items.length === 0 && filter === undefined && (
						<StatusMessage tone="success">No results found.</StatusMessage>
					)}
					{state.items.length > 0 && (
						<div className="w-full max-w-6xl overflow-x-auto">
							<DataTable
								data={state.items}
								getRowId={(item) => item.key}
								rowClassName="h-15 border-b border-border"
								className="w-full border-collapse text-left"
								columns={resultsTableColumns(input.settings.columns)}
								headerClassName="border-b border-border text-xs text-text-muted"
							/>
						</div>
					)}
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
					{state.pageInfo?.hasMore && !result.isError && (
						<LoadMoreButton
							label="Load more"
							disabled={result.isFetching}
							onClick={result.fetchNextPage}
							isFetchingNextPage={result.isFetchingNextPage}
							icon={<AppIcon size={16} name="chevron-down" className="text-text" />}
							aria-label={result.isFetchingNextPage ? "Loading more results" : "Load more results"}
							className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-surface-2 px-4 text-[15px] text-text disabled:opacity-60 @2xl:h-8.5 @2xl:w-auto @2xl:self-center @2xl:border @2xl:border-border @2xl:bg-surface @2xl:text-[13px]"
						/>
					)}
					{state.pageInfo !== null && !state.pageInfo.hasMore && state.items.length > 0 && (
						<p className="text-center text-xs text-text-subtle">
							End of {viewName} · {state.items.length.toLocaleString()} items
						</p>
					)}
				</section>
			</PluginScreenFrame>
			{filtersOpen && (
				<Modal
					label="Filters"
					closeLabel="Close filters"
					onClose={() => setFiltersOpen(false)}
					triggerRef={compact ? optionsTrigger : filtersTrigger}
					containerClassName={
						compact ? "items-end justify-center" : "items-center justify-center p-4"
					}
					className={
						compact
							? "max-h-[90%] w-full overflow-y-auto rounded-t-xl border-t border-border bg-surface p-5"
							: "max-h-[90%] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-surface p-5"
					}
				>
					<h2 className="font-display text-lg font-semibold text-text">Filters</h2>
					<FilterRules
						filter={filter}
						compact={compact}
						onChange={setFilter}
						fields={filterFields}
					/>
				</Modal>
			)}
		</ManagedAssetProvider>
	);
};

export default function ResultsTablePage() {
	const page = Schema.decodeUnknownResult(ResultsTablePageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title="Results table">
			<StatusMessage tone="error">This results-table configuration is invalid.</StatusMessage>
		</PluginScreenFrame>
	) : (
		<ResultsTable input={page.success} />
	);
}
