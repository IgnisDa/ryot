import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	useDisplayText,
	useFormatters,
	useRyotInfiniteQuery,
	useRyotQuery,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame, viewResultLabel } from "@ryot-app/plugin-client-sdk/screen";
import { Button, LoadMoreButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
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
	for (const { value } of item.cells) {
		if (value.displayKind === "text") {
			const text = value.value;
			return (text !== null && typeof text === "object" && "length" in text ? text[0] : text) ?? "";
		}
	}
	return "";
};

const resultsTableColumns = (
	displayText: ReturnType<typeof useDisplayText>,
	declared: (typeof ResultsTablePageInput.Type)["settings"]["columns"],
): readonly DataTableColumn<TableItem>[] =>
	declared.map((column, index) => ({
		id: column.field,
		header: displayText(column.label),
		cell: (item: TableItem) => {
			const value = item.cells.find(({ key }) => key === column.field)?.value;
			const content =
				value === undefined ? null : (
					<CellValue value={value} monogram={displayText(rowLabel(item))} />
				);
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
	const t = useT();
	const controls = useRyotQuery(controlsQuery, input.target);
	if (controls.data === undefined) {
		return (
			<PluginScreenFrame
				title={input.view ? input.view.name : kernelMessage("renderer.results-table.title")}
			>
				{controls.error ? (
					<StatusMessage
						tone="error"
						action={{ onClick: controls.refetch, label: t(kernelMessage("common.action.retry")) }}
					>
						{t(kernelMessage("renderer.results-table.controls-failed"))}
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
	const t = useT();
	const formatters = useFormatters();
	const displayText = useDisplayText();
	const viewTitle = input.view ? input.view.name : kernelMessage("renderer.results-table.title");
	const viewName = displayText(viewTitle);
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
				title={viewTitle}
				titleIcon={<AppIcon size={20} name={viewIcon} className="shrink-0 text-text-muted" />}
				viewOptions={{
					activeCount,
					open: filtersOpen,
					onOpenChange: setFiltersOpen,
					compactTitle: t(kernelMessage("sdk.filters.title")),
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
							{viewResultLabel(t, formatters, {
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
						<StatusMessage tone="pending">
							{t(kernelMessage("renderer.results-table.loading"))}
						</StatusMessage>
					)}
					{initial && result.isError && (
						<StatusMessage tone="error">
							{t(kernelMessage("renderer.results-table.unavailable"))}{" "}
							<Button variant="ghost" onClick={result.refetch}>
								{t(kernelMessage("common.action.retry"))}
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
						<StatusMessage tone="success">
							{t(kernelMessage("renderer.results-table.empty"))}
						</StatusMessage>
					)}
					{state.items.length > 0 && (
						<div className="w-full max-w-6xl overflow-x-auto">
							<DataTable
								data={state.items}
								getRowId={(item) => item.key}
								rowClassName="h-15 border-b border-border"
								className="w-full border-collapse text-left"
								headerClassName="border-b border-border text-xs text-text-muted"
								columns={resultsTableColumns(displayText, input.settings.columns)}
							/>
						</div>
					)}
					{!initial && result.isError && (
						<div
							role="alert"
							className="flex items-center justify-center gap-3 text-sm text-danger"
						>
							<span>{t(kernelMessage("sdk.browser.more-failed"))}</span>
							<Button variant="ghost" className="text-sm" onClick={result.retry}>
								{t(kernelMessage("common.action.retry"))}
							</Button>
						</div>
					)}
					{state.pageInfo?.hasMore && !result.isError && (
						<LoadMoreButton
							disabled={result.isFetching}
							onClick={result.fetchNextPage}
							isFetchingNextPage={result.isFetchingNextPage}
							icon={<AppIcon size={16} name="chevron-down" className="text-text" />}
							aria-label={t(
								kernelMessage(
									result.isFetchingNextPage
										? "sdk.browser.loading-more-results"
										: "sdk.browser.load-more-results",
								),
							)}
							className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-surface-2 px-4 text-[15px] text-text disabled:opacity-60 @2xl:h-8.5 @2xl:w-auto @2xl:self-center @2xl:border @2xl:border-border @2xl:bg-surface @2xl:text-[13px]"
						/>
					)}
					{state.pageInfo !== null && !state.pageInfo.hasMore && state.items.length > 0 && (
						<p className="text-center text-xs text-text-subtle">
							{t(
								kernelMessage("sdk.browser.end-of-results", {
									name: viewName,
									count: state.items.length,
								}),
							)}
						</p>
					)}
				</section>
			</PluginScreenFrame>
		</ManagedAssetProvider>
	);
};

export default function ResultsTablePage() {
	const t = useT();
	const page = Schema.decodeUnknownResult(ResultsTablePageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title={kernelMessage("renderer.results-table.title")}>
			<StatusMessage tone="error">
				{t(kernelMessage("renderer.results-table.invalid"))}
			</StatusMessage>
		</PluginScreenFrame>
	) : (
		<ResultsTable input={page.success} />
	);
}
