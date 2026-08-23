import { Result, Schema } from "@ryot-app/client-sdk/effect";
import { PluginLink, usePageContext, usePageRefresh } from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider, createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { DataTable, type DataTableColumn } from "@ryot-app/client-ui-sdk/table";
import {
	ResultsTablePageInput,
	resultsTableRecipe,
	type ResultsTableResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { CellValue, cellText, managedCellAssets } from "./display-value";

const QueryInput = Schema.Tuple([Schema.NullOr(Schema.String), Schema.Number]);

const decodeQueryInput = Schema.decodeUnknownSync(Schema.fromJsonString(QueryInput));

type TableItem = ResultsTableResult["items"][number];
type TablePage = { readonly input: string; readonly result: ResultsTableResult };
type TableState = {
	readonly items: ResultsTableResult["items"];
	readonly pageInfo: ResultsTableResult["pageInfo"] | null;
};

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
	const [cursor, setCursor] = useState<string | null>(null);
	const [state, setState] = useState<TableState>({ items: [], pageInfo: null });
	const appliedCursors = useRef(new Set<string>());
	const [refreshGeneration, setRefreshGeneration] = useState(0);
	const activeGeneration = useRef(refreshGeneration);
	const refresh = useEffectEvent(() => setRefreshGeneration((current) => current + 1));
	usePageRefresh(refresh);
	const [query] = useState(() =>
		createRyotQuery<string, TablePage>(
			async ({ client, input: serialized, signal }) => {
				const [after] = decodeQueryInput(serialized);
				const result = await client.data.query(
					Result.getOrThrow(
						resultsTableRecipe({
							settings: input.settings,
							queryDocument: input.dataSources,
							...(after === null ? {} : { after }),
						}),
					),
					{ signal },
				);
				return { input: serialized, result };
			},
			{ cancelOnUnmount: true },
		),
	);
	const queryInput = JSON.stringify([cursor, refreshGeneration]);
	const result = useRyotQuery(query, queryInput);

	useEffect(() => {
		if (activeGeneration.current === refreshGeneration) {
			return;
		}
		activeGeneration.current = refreshGeneration;
		appliedCursors.current.clear();
		setCursor(null);
		setState({ items: [], pageInfo: null });
	}, [refreshGeneration]);

	useEffect(() => {
		const page = result.data;
		if (!page || page.input !== queryInput) {
			return;
		}
		const pageKey = page.input;
		if (appliedCursors.current.has(pageKey)) {
			return;
		}
		appliedCursors.current.add(pageKey);
		setState((current) => {
			const seen = new Set(current.items.map(({ key }) => key));
			const items = [...current.items];
			for (const item of page.result.items) {
				if (!seen.has(item.key)) {
					seen.add(item.key);
					items.push(item);
				}
			}
			return { items, pageInfo: page.result.pageInfo };
		});
	}, [queryInput, result.data]);

	const initial = state.pageInfo === null;
	const assets = state.items.flatMap((item) => managedCellAssets(item.cells));

	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				title={viewName}
				titleIcon={<AppIcon size={20} name={viewIcon} className="shrink-0 text-text-muted" />}
				meta={
					<p role="status" className="text-xs text-text-muted @2xl:text-sm">
						{`${state.items.length.toLocaleString()}${
							state.pageInfo?.hasMore ? "+" : ""
						} ${state.items.length === 1 && !state.pageInfo?.hasMore ? "result" : "results"}`}
					</p>
				}
			>
				<section className="@container grid gap-5" aria-busy={result.isFetching}>
					{initial && result.isPending && (
						<StatusMessage tone="pending">Loading results...</StatusMessage>
					)}
					{initial && result.isError && (
						<StatusMessage tone="error">
							Results unavailable.{" "}
							<Button variant="text" onClick={result.refetch}>
								Retry
							</Button>
						</StatusMessage>
					)}
					{!initial && state.items.length === 0 && (
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
							<Button variant="text" className="text-sm" onClick={result.refetch}>
								Retry
							</Button>
						</div>
					)}
					{state.pageInfo?.hasMore && !result.isError && (
						<button
							type="button"
							disabled={result.isFetching}
							aria-label={result.isFetching ? "Loading more results" : "Load more results"}
							className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-surface-2 px-4 text-[15px] text-text disabled:opacity-60 @2xl:h-8.5 @2xl:w-auto @2xl:self-center @2xl:border @2xl:border-border @2xl:bg-surface @2xl:text-[13px]"
							onClick={() => {
								const next = state.pageInfo?.nextCursor;
								if (next) {
									setCursor(next);
								}
							}}
						>
							<AppIcon size={16} name="chevron-down" className="text-text" />
							{result.isFetching ? "Loading..." : "Load more"}
						</button>
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
