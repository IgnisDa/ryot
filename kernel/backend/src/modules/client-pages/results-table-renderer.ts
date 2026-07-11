import type { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";

const source = String.raw`
import { Result, Schema } from "@ryot-app/client-sdk/effect";
import { PluginLink, usePageContext, usePageRefresh } from "@ryot-app/client-sdk/plugin";
import {
  ManagedAssetProvider,
  createRyotQuery,
  useManagedAssetUrl,
  useRyotQuery,
} from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import { EntityArtWell } from "@ryot-app/client-ui-sdk/sync";
import { DataTable, type DataTableColumn } from "@ryot-app/client-ui-sdk/table";
import {
  ResultsTablePageInput,
  resultsTableRecipe,
  type ResultsTableResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useEffect, useEffectEvent, useRef, useState } from "react";

type TableItem = ResultsTableResult["items"][number];
type TableValue = TableItem["cells"][number]["value"];
type TableAsset = Extract<TableValue, { readonly displayKind: "managed-asset" }>["value"];
type TablePage = { readonly input: string; readonly result: ResultsTableResult };
type TableState = {
  readonly items: ResultsTableResult["items"];
  readonly pageInfo: ResultsTableResult["pageInfo"] | null;
};

const formatValue = (value: TableValue) => {
  if (value.value === null || value.displayKind === "managed-asset") return "";
  switch (value.displayKind) {
    case "boolean": return value.value ? "Yes" : "No";
    case "date": return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(new Date(value.value));
    case "number": return new Intl.NumberFormat().format(value.value);
    case "json": return JSON.stringify(value.value) ?? "null";
    case "text": return value.value;
  }
};

const AssetValue = ({ asset }: { readonly asset: TableAsset }) => {
  const managed = asset === null || asset.type === "remote" ? undefined : asset;
  const managedUrl = useManagedAssetUrl(managed);
  return (
    <EntityArtWell
      monogram=""
      state="ready"
      className="size-10 shrink-0"
      url={asset?.type === "remote" ? asset.url : managedUrl}
    />
  );
};

const renderValue = (value: TableValue) => {
  if (value.value === null) return null;
  if (value.displayKind === "managed-asset") return <AssetValue asset={value.value} />;
  const content = formatValue(value);
  return value.displayKind === "date"
    ? <time dateTime={value.value}>{content}</time>
    : content;
};

const ResultsTable = ({ input }: { readonly input: typeof ResultsTablePageInput.Type }) => {
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<TableState>({ items: [], pageInfo: null });
  const appliedCursors = useRef(new Set<string>());
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const activeGeneration = useRef(refreshGeneration);
  const refresh = useEffectEvent(() => setRefreshGeneration((current) => current + 1));
  usePageRefresh(refresh);
  const [query] = useState(() => createRyotQuery<string, TablePage>(
    async ({ client, input: serialized, signal }) => {
      const [after] = JSON.parse(serialized) as [string | null, number];
      const result = await client.data.query(
        Result.getOrThrow(resultsTableRecipe({
          settings: input.settings,
          queryDocument: input.dataSources,
          ...(after === null ? {} : { after }),
        })),
        { signal },
      );
      return { input: serialized, result };
    },
    { cancelOnUnmount: true },
  ));
  const queryInput = JSON.stringify([cursor, refreshGeneration]);
  const result = useRyotQuery(query, queryInput);

  useEffect(() => {
    if (activeGeneration.current === refreshGeneration) return;
    activeGeneration.current = refreshGeneration;
    appliedCursors.current.clear();
    setCursor(null);
    setState({ items: [], pageInfo: null });
  }, [refreshGeneration]);

  useEffect(() => {
    const page = result.data;
    if (!page || page.input !== queryInput) return;
    const pageKey = page.input;
    if (appliedCursors.current.has(pageKey)) return;
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

  const columns: readonly DataTableColumn<TableItem>[] = input.settings.columns.map((column, index) => ({
    id: column.field,
    header: column.label,
    cell: (item) => {
      const value = item.cells.find(({ key }) => key === column.field)?.value;
      const content = value === undefined ? null : renderValue(value);
      return index === 0 && item.entityId !== undefined ? (
        <PluginLink to={{ kind: "entity", entityId: item.entityId }}>{content}</PluginLink>
      ) : content;
    },
  }));
  const initial = state.pageInfo === null;
  const assets = state.items.flatMap((item) => item.cells.flatMap(({ value }) =>
    value.displayKind === "managed-asset" && value.value !== null && value.value.type !== "remote"
      ? [value.value]
      : [],
  ));

  return (
    <ManagedAssetProvider assets={assets}>
      <PluginScreenFrame
        title="Results table"
        meta={<p role="status">{state.items.length} loaded</p>}
        actions={<Button variant="secondary" disabled={result.isFetching} onClick={refresh}>Refresh</Button>}
      >
      <section className="grid gap-5" aria-busy={result.isFetching}>
        {initial && result.isPending && <StatusMessage tone="pending">Loading results...</StatusMessage>}
        {initial && result.isError && (
          <StatusMessage tone="error">
            Results unavailable. <Button variant="text" onClick={result.refetch}>Retry</Button>
          </StatusMessage>
        )}
        {!initial && state.items.length === 0 && (
          <StatusMessage tone="success">No results found.</StatusMessage>
        )}
        {state.items.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <DataTable
              data={state.items}
              columns={columns}
              getRowId={(item) => item.key}
              className="w-full border-collapse text-left text-sm"
              headerClassName="border-b border-border bg-surface-2 text-text-muted"
              rowClassName="border-b border-border last:border-b-0"
            />
          </div>
        )}
        {!initial && result.isError && (
          <StatusMessage tone="error">
            More results could not be loaded. <Button variant="text" onClick={result.refetch}>Retry</Button>
          </StatusMessage>
        )}
        {state.pageInfo?.hasMore && !result.isError && (
          <Button
            variant="secondary"
            disabled={result.isFetching}
            onClick={() => {
              const next = state.pageInfo?.nextCursor;
              if (next) setCursor(next);
            }}
          >
            {result.isFetching ? "Loading more..." : "Load more"}
          </Button>
        )}
        {state.pageInfo !== null && !state.pageInfo.hasMore && state.items.length > 0 && (
          <p className="text-sm text-text-muted">End of results.</p>
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
  ) : <ResultsTable input={page.success} />;
}
`;

const files = { "client/results-table.tsx": new TextEncoder().encode(source) } as const;

export const kernelResultsTableRenderer = {
	files,
	name: "Results table",
	sourceHash: sha256Hex(source),
	definition: {
		files: [],
		pluginDependencies: [],
		settingsSchema: { fields: {} },
		entry: "client/results-table.tsx",
		automaticEntityPresentations: false,
	} satisfies ClientRendererDefinition,
};
