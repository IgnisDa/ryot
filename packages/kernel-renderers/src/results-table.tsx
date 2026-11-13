import type { DescribeResponse } from "@ryot-app/plugin-client-sdk";
import {
	BrowserNoMatches,
	CellValue,
	managedCellAssets,
} from "@ryot-app/plugin-client-sdk/browser";
import { Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	FilterChips,
	FilterRules,
	useViewFilter,
	type ViewFilter,
} from "@ryot-app/plugin-client-sdk/filters";
import { PluginLink, usePageContext, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame, viewResultLabel } from "@ryot-app/plugin-client-sdk/screen";
import { Button, LoadMoreButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { DataTable, type DataTableColumn, displayValueText } from "@ryot-app/plugin-ui-sdk/table";
import { queryFilterFields } from "@ryot-app/ryotql-recipes/filters";
import {
	decodeResultsTableResult,
	ResultsTablePageInput,
	type ResultsTableResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useState } from "react";

type TableItem = ResultsTableResult["items"][number];

type QueryInput = { readonly after: null | string; readonly filter: null | ViewFilter };

const rowLabel = (item: TableItem) => {
	const text = item.cells.find(({ value }) => value.displayKind === "text");
	return text === undefined ? "" : displayValueText(text.value);
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

const controlsQuery = createRyotQuery<
	typeof ResultsTablePageInput.Type.target,
	typeof DescribeResponse.Type.filter
>(({ input, client }) =>
	client.data
		.describe({ query: "count", kind: "savedView", reference: input.reference })
		.pipe(Effect.map((description) => description.filter)),
);

const ResultsTable = ({ input }: { readonly input: typeof ResultsTablePageInput.Type }) => {
	const controls = useRyotQuery(controlsQuery, input.target);
	if (controls.data === undefined) {
		return (
			<PluginScreenFrame title={input.view?.name ?? "Results table"}>
				{controls.error ? (
					<StatusMessage tone="error" action={{ label: "Retry", onClick: controls.refetch }}>
						The table controls could not be loaded.
					</StatusMessage>
				) : null}
			</PluginScreenFrame>
		);
	}
	return <ResultsTableContent input={input} fields={controls.data} />;
};
const ResultsTableContent = ({
	input,
	fields,
}: {
	readonly input: typeof ResultsTablePageInput.Type;
	readonly fields: typeof DescribeResponse.Type.filter;
}) => {
	const viewName = input.view?.name ?? "Results table";
	const viewIcon = input.view?.icon ?? "table";
	const { compact } = useRyotViewport();
	const [filtersOpen, setFiltersOpen] = useState(false);
	const filterFields = queryFilterFields(fields);
	const { filter, setFilter, activeCount } = useViewFilter(filterFields);
	const [query] = useState(() =>
		createRyotQuery<QueryInput, ResultsTableResult>(
			({ client, input: { after, filter: appliedFilter } }) =>
				client.data.execute(
					{
						source: {
							kind: "savedView",
							query: input.settings.sourceName,
							reference: input.target.reference,
						},
						...(appliedFilter === null ? {} : { filter: appliedFilter }),
						pages: {
							[input.settings.sourceName]: {
								limit: input.settings.pageSize,
								...(after === null ? {} : { after }),
							},
						},
					},
					(response) =>
						decodeResultsTableResult(response, input.settings.sourceName, input.settings),
				),
			{ cancelOnUnmount: true },
		),
	);
	const result = useRyotInfiniteQuery(
		query,
		{ filter: filter ?? null, reference: input.target.reference },
		{
			initialPageParam: null,
			getNextPageParam: nextPageCursor,
			getPageInput: (selection, after: null | string) => ({ after, filter: selection.filter }),
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
				viewOptions={{
					activeCount,
					open: filtersOpen,
					compactTitle: "Filters",
					onOpenChange: setFiltersOpen,
					content: (
						<FilterRules
							filter={filter}
							compact={compact}
							onChange={setFilter}
							fields={filterFields}
						/>
					),
				}}
				meta={
					<>
						<p role="status" className="text-xs text-text-muted @2xl:text-sm">
							{viewResultLabel({
								total: undefined,
								loaded: state.items.length,
								hasMore: state.pageInfo?.hasMore ?? false,
							})}
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
							add={undefined}
							name={viewName}
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
