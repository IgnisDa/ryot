import type { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";

const source = String.raw`
import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
  EntityResults,
  PluginLink,
  usePageContext,
  usePageRefresh,
  usePluginLocation,
} from "@ryot-app/client-sdk/plugin";
import {
  ManagedAssetProvider,
  createRyotQuery,
  useManagedAssetUrl,
  useRyot,
  useRyotQuery,
} from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, SearchField, SegmentedControl, Select, StatusMessage } from "@ryot-app/client-ui-sdk";
import { EntityArtWell } from "@ryot-app/client-ui-sdk/sync";
import { DataTable, type DataTableColumn } from "@ryot-app/client-ui-sdk/table";
import {
  EntityBrowserPageInput,
  entityBrowserCountRecipe,
  entityBrowserRecipe,
  type EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useEffect, useEffectEvent, useRef, useState } from "react";

type BrowserItem = EntityBrowserResult["items"][number];
type BrowserValue = BrowserItem["cells"][number]["value"];
type BrowserAsset = Extract<BrowserValue, { readonly displayKind: "managed-asset" }>["value"];
type BrowserControls = {
  readonly layout: "grid" | "list" | "table";
  readonly search: string;
  readonly sort: string;
};
type BrowserPage = {
  readonly input: string;
  readonly result: EntityBrowserResult;
};
type BrowserState = {
  readonly identity: string;
  readonly items: EntityBrowserResult["items"];
  readonly pageInfo: EntityBrowserResult["pageInfo"] | null;
};

let retained: { readonly state: BrowserState; readonly pages: ReadonlySet<string> } | undefined;

const controlIcon = (value: string) => <span aria-hidden="true">{value}</span>;

const formatValue = (value: BrowserValue) => {
  if (value.value === null || value.displayKind === "managed-asset") return "";
  switch (value.displayKind) {
    case "boolean": return value.value ? "Yes" : "No";
    case "date": return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(new Date(value.value));
    case "number": return new Intl.NumberFormat().format(value.value);
    case "json": return JSON.stringify(value.value) ?? "null";
    case "text": return value.value;
  }
};

const AssetValue = ({ asset }: { readonly asset: BrowserAsset }) => {
  const managed = asset === null || asset.type === "remote" ? undefined : asset;
  const managedUrl = useManagedAssetUrl(managed);
  return (
    <EntityArtWell
      state="ready"
      monogram=""
      className="size-10 shrink-0"
      url={asset?.type === "remote" ? asset.url : managedUrl}
    />
  );
};

const renderValue = (value: BrowserValue) => {
  if (value.value === null) return null;
  if (value.displayKind === "managed-asset") return <AssetValue asset={value.value} />;
  const content = formatValue(value);
  return value.displayKind === "date"
    ? <time dateTime={value.value}>{content}</time>
    : content;
};

const Count = ({
  input,
  searchText,
}: {
  readonly input: typeof EntityBrowserPageInput.Type;
  readonly searchText: string;
}) => {
  const [query] = useState(() => createRyotQuery<string, number>(({ client, input: search, signal }) =>
    client.data.query(
      Result.getOrThrow(entityBrowserCountRecipe(input.dataSources, input.settings, {
        ...(search === "" ? {} : { searchText: search }),
      })),
      { signal },
    ),
  ));
  const result = useRyotQuery(query, searchText);
  if (result.isPending) return <StatusMessage tone="pending">Counting...</StatusMessage>;
  if (result.isError) {
    return (
      <StatusMessage tone="error">
        Count unavailable. <Button variant="text" onClick={result.refetch}>Retry count</Button>
      </StatusMessage>
    );
  }
  return <p role="status">{result.data?.toLocaleString() ?? "0"} total</p>;
};

const BrowserTable = ({ items }: { readonly items: EntityBrowserResult["items"] }) => {
  const first = items[0];
  const columns: readonly DataTableColumn<BrowserItem>[] = (first?.cells ?? []).map((cell, index) => ({
    id: cell.key,
    header: cell.label,
    cell: (item) => {
      const value = item.cells.find(({ key }) => key === cell.key)?.value;
      const content = value === undefined ? null : renderValue(value);
      return index === 0 ? (
        <PluginLink to={{ kind: "entity", entityId: item.entityId }}>{content}</PluginLink>
      ) : content;
    },
  }));
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <DataTable
        data={items}
        columns={columns}
        getRowId={(item) => item.entityId}
        className="w-full border-collapse text-left text-sm"
        headerClassName="border-b border-border bg-surface-2 text-text-muted"
        rowClassName="border-b border-border last:border-b-0"
      />
    </div>
  );
};

const Browser = ({ input }: { readonly input: typeof EntityBrowserPageInput.Type }) => {
  const ryot = useRyot();
  const location = usePluginLocation();
  const params = new URLSearchParams(location.search);
  const requestedLayout = params.get("layout");
  const requestedSort = params.get("sort") ?? "";
  const requestedSearch = params.get("search") ?? "";
  const fallbackLayout = input.settings.layouts.includes(input.settings.defaultLayout)
    ? input.settings.defaultLayout
    : input.settings.layouts[0];
  const requestedControls: BrowserControls = {
    layout: input.settings.layouts.find((candidate) => candidate === requestedLayout) ?? fallbackLayout,
    search: input.settings.searchFields.length === 0 ? "" : requestedSearch,
    sort: input.settings.sortChoices.some(({ name }) => name === requestedSort) ? requestedSort : "",
  };
  const [controls, setControls] = useState(requestedControls);
  const controlsRef = useRef(controls);
  const pendingSearch = useRef<
    { readonly identity: string; readonly update: Record<string, string | null> } | undefined
  >(undefined);
  const { layout, search: searchText, sort: sortChoice } = controls;
  const [cursor, setCursor] = useState<string | null>(null);
  const [showCount, setShowCount] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const identity = JSON.stringify([searchText, sortChoice, refreshGeneration]);
  const [state, setState] = useState<BrowserState>(() =>
    retained?.state.identity === identity ? retained.state : { identity, items: [], pageInfo: null },
  );
  const appliedPages = useRef(
    new Set(retained?.state.identity === identity ? retained.pages : undefined),
  );
  const activeIdentity = useRef(identity);
  const refresh = useEffectEvent(() => setRefreshGeneration((current) => {
    const next = current + 1;
    const pending = pendingSearch.current;
    if (pending) {
      pendingSearch.current = {
        ...pending,
        identity: JSON.stringify([controlsRef.current.search, controlsRef.current.sort, next]),
      };
    }
    return next;
  }));
  usePageRefresh(refresh);
  const [query] = useState(() => createRyotQuery<string, BrowserPage>(
    async ({ client, input: serialized, signal }) => {
      const [search, sort, after] = JSON.parse(serialized) as [string, string, string | null, number];
      const result = await client.data.query(
        Result.getOrThrow(entityBrowserRecipe({
          settings: input.settings,
          queryDocument: input.dataSources,
          ...(search === "" ? {} : { searchText: search }),
          ...(sort === "" ? {} : { sortChoice: sort }),
          ...(after === null ? {} : { after }),
        })),
        { signal },
      );
      return { input: serialized, result };
    },
    { cancelOnUnmount: true },
  ));
  const queryInput = JSON.stringify([searchText, sortChoice, cursor, refreshGeneration]);
  const result = useRyotQuery(query, queryInput);

  useEffect(() => {
    if (pendingSearch.current) return;
    controlsRef.current = requestedControls;
    setControls(requestedControls);
  }, [requestedControls.layout, requestedControls.search, requestedControls.sort]);

  useEffect(() => {
    if (activeIdentity.current === identity) return;
    activeIdentity.current = identity;
    appliedPages.current.clear();
    setCursor(null);
    setState({ identity, items: [], pageInfo: null });
  }, [identity]);

  useEffect(() => {
    const page = result.data;
    if (!page || page.input !== queryInput) return;
    const pageKey = page.input;
    if (appliedPages.current.has(pageKey)) return;
    appliedPages.current.add(pageKey);
    setState((current) => {
      if (current.identity !== identity) return current;
      const seen = new Set(current.items.map(({ entityId }) => entityId));
      const items = [...current.items];
      for (const item of page.result.items) {
        if (!seen.has(item.entityId)) {
          seen.add(item.entityId);
          items.push(item);
        }
      }
      return { identity, items, pageInfo: page.result.pageInfo };
    });
  }, [identity, queryInput, result.data]);

  useEffect(() => {
    retained = { state, pages: new Set(appliedPages.current) };
  }, [state]);

  useEffect(() => {
    const pending = pendingSearch.current;
    if (!pending || pending.identity !== identity || state.identity !== identity || state.pageInfo === null) return;
    pendingSearch.current = undefined;
    ryot.navigation.pageSearch.replace(pending.update);
  }, [identity, ryot, state.identity, state.pageInfo]);

  const current = state.identity === identity ? state : { identity, items: [], pageInfo: null };
  const references = current.items.map((item) => ({
    name: item.name,
    entityId: item.entityId,
    ownerPluginId: item.ownerPluginId,
    entitySchemaSlug: item.entitySchemaSlug,
    ...item.sync,
  }));
  const layouts = input.settings.layouts.map((value) => ({
    value,
    label: value === "grid" ? "Grid view" : value === "list" ? "List view" : "Table view",
    content: value === "grid" ? "Grid" : value === "list" ? "List" : "Table",
  }));
  const initial = current.pageInfo === null;
  const addAction = input.settings.addAction;
  const assets = current.items.flatMap((item) => item.cells.flatMap(({ value }) =>
    value.displayKind === "managed-asset" && value.value !== null && value.value.type !== "remote"
      ? [value.value]
      : [],
  ));
  const setQueryControls = (update: Partial<Pick<BrowserControls, "search" | "sort">>) => {
    const next = { ...controlsRef.current, ...update };
    controlsRef.current = next;
    pendingSearch.current = {
      identity: JSON.stringify([next.search, next.sort, refreshGeneration]),
      update: { search: next.search || null, sort: next.sort || null },
    };
    setControls(next);
  };
  const setSearch = (value: string) => setQueryControls({ search: value });
  const setSort = (value: string) => setQueryControls({ sort: value });
  const setLayout = (value: string) => {
    if (value !== "grid" && value !== "list" && value !== "table") return;
    const next: BrowserControls = { ...controlsRef.current, layout: value };
    controlsRef.current = next;
    setControls(next);
    ryot.navigation.pageSearch.replace({ layout: value });
  };

  return (
    <ManagedAssetProvider assets={assets}>
      <PluginScreenFrame
      title="Entity browser"
      meta={<p role="status">{current.items.length} loaded</p>}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {input.settings.searchFields.length > 0 && (
            <SearchField
              value={searchText}
              onChange={setSearch}
              label="Search this view"
              icon={controlIcon("S")}
              clearIcon={controlIcon("x")}
              className="h-10 min-w-52 flex-1"
            />
          )}
          {input.settings.sortChoices.length > 0 && (
            <Select
              value={sortChoice}
              onChange={setSort}
              label="Sort results"
              className="w-48"
              checkIcon={controlIcon("check")}
              chevronIcon={controlIcon("v")}
              choices={[
                { value: "", label: "Default order" },
                ...input.settings.sortChoices.map(({ name, label }) => ({ value: name, label })),
              ]}
            />
          )}
          <SegmentedControl
            value={layout}
            options={layouts}
            onChange={setLayout}
            label="Entity browser layout"
          />
          <Button variant="secondary" disabled={result.isFetching} onClick={refresh}>Refresh</Button>
          {addAction !== null && (
            <Button
              onClick={() => ryot.screens.openProviderSearch({
                ownerPluginId: addAction.ownerPluginId,
                entitySchemaSlug: addAction.entitySchemaSlug,
                ...(searchText === "" ? {} : { initialQuery: searchText }),
              })}
            >
              Add
            </Button>
          )}
        </div>
      }
    >
      <section className="grid gap-5" aria-busy={result.isFetching}>
        {initial && result.isPending && <StatusMessage tone="pending">Loading entities...</StatusMessage>}
        {initial && result.isError && (
          <StatusMessage tone="error">
            Entities unavailable. <Button variant="text" onClick={result.refetch}>Retry</Button>
          </StatusMessage>
        )}
        {!initial && current.items.length === 0 && (
          <StatusMessage tone="success">No entities found.</StatusMessage>
        )}
        {current.items.length > 0 && layout === "table" && <BrowserTable items={current.items} />}
        {current.items.length > 0 && layout !== "table" && (
          <EntityResults
            references={references}
            layout={layout}
            viewContext={{ savedViewId: input.target.savedViewId }}
          />
        )}
        {!initial && result.isError && (
          <StatusMessage tone="error">
            More entities could not be loaded. <Button variant="text" onClick={result.refetch}>Retry</Button>
          </StatusMessage>
        )}
        {current.pageInfo?.hasMore && !result.isError && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={result.isFetching}
              onClick={() => {
                const next = current.pageInfo?.nextCursor;
                if (next) setCursor(next);
              }}
            >
              {result.isFetching ? "Loading more..." : "Load more"}
            </Button>
            {!showCount && <Button variant="text" onClick={() => setShowCount(true)}>Count all</Button>}
            {showCount && <Count key={identity} input={input} searchText={searchText} />}
          </div>
        )}
        {current.pageInfo !== null && !current.pageInfo.hasMore && current.items.length > 0 && (
          <p className="text-sm text-text-muted">End of results.</p>
        )}
      </section>
      </PluginScreenFrame>
    </ManagedAssetProvider>
  );
};

export default function EntityBrowserPage() {
  const page = Schema.decodeUnknownResult(EntityBrowserPageInput)(usePageContext());
  return Result.isFailure(page) ? (
    <PluginScreenFrame title="Entity browser">
      <StatusMessage tone="error">This entity browser configuration is invalid.</StatusMessage>
    </PluginScreenFrame>
  ) : <Browser input={page.success} />;
}
`;

const files = { "client/entity-browser.tsx": new TextEncoder().encode(source) } as const;

export const kernelEntityBrowserRenderer = {
	files,
	name: "Entity browser",
	sourceHash: sha256Hex(source),
	definition: {
		files: [],
		pluginDependencies: [],
		settingsSchema: { fields: {} },
		entry: "client/entity-browser.tsx",
		automaticEntityPresentations: true,
	} satisfies ClientRendererDefinition,
};
