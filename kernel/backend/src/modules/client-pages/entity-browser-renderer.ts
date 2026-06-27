import type { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";

const source = String.raw`
import { Result, Schema } from "@ryot-app/client-sdk/effect";
import { EntityResults, usePageContext } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, SegmentedControl, StatusMessage } from "@ryot-app/client-ui-sdk";
import {
  EntityBrowserPageInput,
  entityBrowserCountRecipe,
  entityBrowserRecipe,
  type EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useEffect, useRef, useState } from "react";

type BrowserState = {
  readonly items: EntityBrowserResult["items"];
  readonly pageInfo: EntityBrowserResult["pageInfo"] | null;
};

const Count = ({ input }: { readonly input: typeof EntityBrowserPageInput.Type }) => {
  const [query] = useState(() => createRyotQuery(({ client, signal }) =>
    client.data.query(
      Result.getOrThrow(entityBrowserCountRecipe(input.dataSources, input.settings)),
      { signal },
    ),
  ));
  const result = useRyotQuery(query);
  if (result.isPending) {
    return <StatusMessage tone="pending">Counting...</StatusMessage>;
  }
  if (result.isError) {
    return (
      <StatusMessage tone="error">
        Count unavailable. <Button variant="text" onClick={result.refetch}>Retry count</Button>
      </StatusMessage>
    );
  }
  return <p role="status">{result.data?.toLocaleString() ?? "0"} total</p>;
};

const Browser = ({ input }: { readonly input: typeof EntityBrowserPageInput.Type }) => {
  const [layout, setLayout] = useState(input.settings.defaultLayout);
  const [cursor, setCursor] = useState<string | null>(null);
  const [showCount, setShowCount] = useState(false);
  const [state, setState] = useState<BrowserState>({ items: [], pageInfo: null });
  const appliedCursors = useRef(new Set<string>());
  const [query] = useState(() => createRyotQuery<string | null, EntityBrowserResult>(
    ({ client, input: after, signal }) => client.data.query(
      Result.getOrThrow(entityBrowserRecipe({
        settings: input.settings,
        queryDocument: input.dataSources,
        ...(after === null ? {} : { after }),
      })),
      { signal },
    ),
    { cancelOnUnmount: true },
  ));
  const result = useRyotQuery(query, cursor);

  useEffect(() => {
    if (!result.data) {
      return;
    }
    const pageKey = cursor ?? "initial";
    if (appliedCursors.current.has(pageKey)) {
      return;
    }
    appliedCursors.current.add(pageKey);
    setState((current) => {
      const seen = new Set(current.items.map(({ entityId }) => entityId));
      const items = [...current.items];
      for (const item of result.data?.items ?? []) {
        if (!seen.has(item.entityId)) {
          seen.add(item.entityId);
          items.push(item);
        }
      }
      return { items, pageInfo: result.data?.pageInfo ?? current.pageInfo };
    });
  }, [cursor, result.data]);

  const references = state.items.map((item) => ({
    name: item.name,
    entityId: item.entityId,
    ownerPluginId: item.ownerPluginId,
    entitySchemaSlug: item.entitySchemaSlug,
    ...item.sync,
  }));
  const layouts = input.settings.layouts.map((value) => ({
    value,
    label: value === "grid" ? "Grid view" : "List view",
    content: value === "grid" ? "Grid" : "List",
  }));
  const initial = state.pageInfo === null;

  return (
    <PluginScreenFrame
      title="Entity browser"
      meta={<p role="status">{state.items.length} loaded</p>}
      actions={
        <SegmentedControl
          value={layout}
          options={layouts}
          onChange={setLayout}
          label="Entity browser layout"
        />
      }
    >
      <section className="grid gap-5" aria-busy={result.isFetching}>
        {initial && result.isPending && (
          <StatusMessage tone="pending">Loading entities...</StatusMessage>
        )}
        {initial && result.isError && (
          <StatusMessage tone="error">
            Entities unavailable. <Button variant="text" onClick={result.refetch}>Retry</Button>
          </StatusMessage>
        )}
        {!initial && state.items.length === 0 && (
          <StatusMessage tone="success">No entities found.</StatusMessage>
        )}
        {state.items.length > 0 && (
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
        {state.pageInfo?.hasMore && !result.isError && (
          <div className="flex flex-wrap items-center gap-3">
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
            {!showCount && <Button variant="text" onClick={() => setShowCount(true)}>Count all</Button>}
            {showCount && <Count input={input} />}
          </div>
        )}
        {state.pageInfo !== null && !state.pageInfo.hasMore && state.items.length > 0 && (
          <p className="text-sm text-text-muted">End of results.</p>
        )}
      </section>
    </PluginScreenFrame>
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
