import type { ContractRequest, ContractSuccess } from "@ryot-app/contract/client";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import {
	aggregate,
	and,
	ascending,
	column,
	document,
	eq,
	field,
	groupAscending,
	inArray,
	join,
	jsonPath,
	literal,
	measure,
	rows,
	table,
	timeSeries,
} from "@ryot-app/ryotql";
import {
	clientRendererRecipe,
	clientRenderersRecipe,
} from "@ryot-app/ryotql-recipes/client-renderers";
import { normalizeSlug } from "@ryot-app/ts-utils/slug";
import { Effect, Encoding } from "effect";

import type { Client } from "./auth";
import { collectRyotQLRecipeItems, executeRyotQLRecipe } from "./ryotql";

type CreateSavedViewRequest = ContractRequest<"savedViews", "create">;
type PrepareClientPageRequest = ContractRequest<"clientPages", "prepare">;
type CreateRendererRequest = ContractRequest<"clientPages", "createRenderer">;
type PublishRendererRequest = ContractRequest<"clientPages", "publishRenderer">;
type CheckClientPageFreshnessRequest = ContractRequest<"clientPages", "checkFreshness">;
type ReplaceRendererDraftRequest = ContractRequest<"clientPages", "replaceRendererDraft">;

type CreateRendererPayload = CreateRendererRequest["payload"];
type RendererId = ContractSuccess<"clientPages", "createRenderer">["id"];
type ClientRendererDefinition = CreateRendererRequest["payload"]["draftDefinition"];
type RendererSavedViewPayload = Extract<CreateSavedViewRequest["payload"], { renderer: unknown }>;
type KernelSavedViewPayload = Omit<RendererSavedViewPayload, "renderer"> & {
	readonly renderer: Extract<RendererSavedViewPayload["renderer"], { kind: "kernel" }>;
};
type SavedViewClientPageTarget = Extract<
	PrepareClientPageRequest["payload"]["target"],
	{ kind: "saved-view" }
>;
type CustomRendererId = Extract<
	RendererSavedViewPayload["renderer"],
	{ kind: "custom" }
>["rendererId"];

const clientRendererSource = `
import { usePageContext } from "@ryot-app/client-sdk/plugin";

export default function Page() {
  const { settings } = usePageContext();
  return (
    <section>
      <h1>Task 01 composed page</h1>
      <p>Renderer setting: {String(settings.label ?? "")}</p>
    </section>
  );
}
`;

const composedClientRendererSource = `
import { usePageContext } from "@ryot-app/client-sdk/plugin";
import PokemonTypes from "@ryot-app/plugins/fixture/pokemon-types";
import ShowProgress from "@ryot-app/plugins/media/show-progress";

export default function Page() {
  const { settings } = usePageContext();
  return (
    <main>
      <h1>Task 02 composed page</h1>
      <p>Renderer setting: {String(settings.label ?? "")}</p>
      <ShowProgress name="E2E deterministic show" totalEpisodes={8} watchedEpisodes={3} />
      <PokemonTypes name="E2E deterministic Pokemon" types={["grass", "poison"]} />
    </main>
  );
}
`;

const namedDataSourcesRendererSource = `
import { Result, Schema } from "@ryot-app/client-sdk/effect";
import { usePageContext } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import { useState } from "react";

const NativeRow = Schema.Struct({ name: Schema.String });
const NativeResult = Schema.Struct({
  type: Schema.Literal("rows"),
  items: Schema.Array(NativeRow),
  pageInfo: Schema.Struct({ hasMore: Schema.Boolean, nextCursor: Schema.NullOr(Schema.String) }),
});
const GroupedResult = Schema.Struct({
  type: Schema.Literal("aggregate"),
  items: Schema.Array(Schema.Struct({ schema: Schema.String, count: Schema.Number })),
});
const TimeSeriesResult = Schema.Struct({
  type: Schema.Literal("timeSeries"),
  buckets: Schema.Array(Schema.Struct({
    value: Schema.Number,
    endAt: Schema.String,
    startAt: Schema.String,
  })),
});
const NamedResults = Schema.Struct({
  data: Schema.Struct({ native: NativeResult, grouped: GroupedResult, timeline: TimeSeriesResult }),
});
type NamedData = typeof NamedResults.Type["data"];
type DataSources = NonNullable<ReturnType<typeof usePageContext>["dataSources"]>;

const StructuredPage = ({ dataSources }: { readonly dataSources: DataSources }) => {
  const [query] = useState(() => createRyotQuery<NamedData>(({ client, signal }) =>
    client.data.query({
      document: dataSources,
      decode: (response: unknown) => Result.map(
        Schema.decodeUnknownResult(NamedResults)(response),
        ({ data }) => data,
      ),
    }, { signal }),
  ));
  const result = useRyotQuery(query);
  if (!result.data) return <p>{result.isError ? "Query failed" : "Loading"}</p>;
  return (
    <main>
      <h1>Named data sources</h1>
      <p>Native rows: {result.data.native.items.map(({ name }) => name).join(" | ")}</p>
      <p>Grouped aggregate: {result.data.grouped.items.map(({ schema, count }) => schema + "=" + count).join(" | ")}</p>
      <p>Time series: {result.data.timeline.buckets.map(({ value }) => value).join(",")}</p>
    </main>
  );
};

export default function Page() {
  const { dataSources } = usePageContext();
  return dataSources === null ? <p>Missing data sources</p> : <StructuredPage dataSources={dataSources} />;
}
`;

export const collectionWorkflowRendererSource = `
import { Result, Schema } from "@ryot-app/client-sdk/effect";
import { EntityResults, usePageContext, usePageRefresh } from "@ryot-app/client-sdk/plugin";
import { createRyotMutation, createRyotQuery, useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import { and, ascending, column, defineRecipe, eq, groupAscending, join, literal, selectedAggregate, selectedField, selectedMeasure, selectedRows, table, type Recipe } from "@ryot-app/client-sdk/ryotql";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import PokemonPicker from "@ryot-app/plugins/fixture/pokemon-picker";
import WorkoutRowPresentation from "@ryot-app/plugins/fitness/workout-row";
import ShowProgress from "@ryot-app/plugins/media/show-progress";
import ShowRowPresentation from "@ryot-app/plugins/media/show-row";
import { useEffect, useEffectEvent, useRef, useState } from "react";

const Settings = Schema.Struct({ collectionId: Schema.String, pageSize: Schema.Number });
const Greeting = Schema.Struct({ greeting: Schema.String });
const importedDomainPresentations = [ShowRowPresentation, WorkoutRowPresentation];
type CollectionPageInput = {
  readonly collectionId: string;
  readonly pageSize: number;
  readonly after: string | undefined;
};
type CollectionState = {
  readonly depth: number;
  readonly grouped: CollectionPageData["grouped"];
  readonly items: CollectionPageData["members"]["items"];
  readonly pageInfo: CollectionPageData["members"]["pageInfo"];
};
type RefreshReplay = {
  readonly generation: number;
  readonly targetDepth: number;
  readonly pages: readonly CollectionPageData[];
  readonly complete: () => void;
};
const syncStatus = (status: string): "pending" | "ready" | "none" =>
  status === "pending" || status === "ready" ? status : "none";

const collectionPageRecipe = defineRecipe((input: CollectionPageInput) => {
  const membership = table("relationship", "collectionMembership");
  const entity = table("entity", "collectionEntity");
  const ownerPlugin = table("plugin", "ownerPlugin");
  const joins = [
    join("inner", entity, eq(column(membership, "sourceEntityId"), column(entity, "id"))),
    join("left", ownerPlugin, eq(column(entity, "entitySchemaPluginId"), column(ownerPlugin, "id"))),
  ];
  const where = and(
    eq(column(membership, "targetEntityId"), literal(input.collectionId)),
    eq(column(membership, "relationshipSchemaSlug"), literal("member-of")),
  );
  return {
    queries: {
      members: selectedRows(membership, {
        after: input.after,
        joins,
        where,
        limit: input.pageSize,
        orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
        selection: {
          entityId: selectedField(column(entity, "id"), Schema.String),
          name: selectedField(column(entity, "name"), Schema.NullOr(Schema.String)),
          ownerPluginId: selectedField(column(entity, "entitySchemaPluginId"), Schema.NullOr(Schema.String)),
          entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
          populationStatus: selectedField(column(entity, "populationStatus"), Schema.String),
          translationStatus: selectedField(column(entity, "translationStatus"), Schema.String),
        },
      }),
      grouped: selectedAggregate(membership, {
        joins,
        where,
        groupBy: {
          ownerPluginId: selectedField(column(entity, "entitySchemaPluginId"), Schema.NullOr(Schema.String)),
          ownerPluginName: selectedField(column(ownerPlugin, "name"), Schema.NullOr(Schema.String)),
          ownerPluginSlug: selectedField(column(ownerPlugin, "slug"), Schema.NullOr(Schema.String)),
          schemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
        },
        measures: { count: selectedMeasure({ function: "count" }, Schema.Number) },
        orderBy: [groupAscending("ownerPluginId"), groupAscending("schemaSlug")],
        limit: 100,
      }),
    },
    map: ({ members, grouped }) => Result.succeed({
      grouped: grouped.items,
      members: {
        ...members,
        items: members.items.map((member) => ({
          ...member,
          populationStatus: syncStatus(member.populationStatus),
          translationStatus: syncStatus(member.translationStatus),
        })),
      },
    }),
  };
});

type CollectionPageData = Recipe.Success<typeof collectionPageRecipe>;
type CollectionQueryPage = { readonly input: string; readonly result: CollectionPageData };
const collectionPageQuery = createRyotQuery<string, CollectionQueryPage>(async ({ client, input, signal }) => {
  const [collectionId, pageSize, after] = JSON.parse(input) as [string, number, string | null, number];
  return {
    input,
    result: await client.data.query(
      collectionPageRecipe({ collectionId, pageSize, after: after ?? undefined }),
      { signal },
    ),
  };
});

const schemaLabel = (group: CollectionPageData["grouped"][number]) => {
  if (group.ownerPluginSlug === "fixture" && group.schemaSlug === "pokemon") return "Pokemon";
  if (group.ownerPluginId === null && group.schemaSlug === "collection") return "Collections";
  return group.ownerPluginName === null ? group.schemaSlug : group.ownerPluginName + " / " + group.schemaSlug;
};

const greetingMutation = createRyotMutation(({ client }) => client.operations.invoke({
  slug: "greet",
  input: { name: "Media collection page" },
  output: Greeting,
  pluginSlug: "fixture",
}));

const CollectionPage = ({ collectionId, pageSize }: typeof Settings.Type) => {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);
  const [state, setState] = useState<CollectionState | undefined>(undefined);
  const stateRef = useRef(state);
  const appliedPages = useRef(new Set<string>());
  const replay = useRef<RefreshReplay | undefined>(undefined);
  const refresh = useEffectEvent(() => new Promise<void>((complete) => {
    replay.current?.complete();
    const next = ++generationRef.current;
    replay.current = {
      complete,
      generation: next,
      pages: [],
      targetDepth: Math.max(1, stateRef.current?.depth ?? 1),
    };
    appliedPages.current.clear();
    setCursor(undefined);
    setGeneration(next);
  }));
  usePageRefresh(refresh);
  useEffect(() => () => replay.current?.complete(), []);
  const queryInput = JSON.stringify([collectionId, pageSize, cursor, generation]);
  const page = useRyotQuery(collectionPageQuery, queryInput, { refreshOnMutation: false });
  const greeting = useRyotMutation(greetingMutation);
  useEffect(() => {
    const response = page.data;
    if (!response || response.input !== queryInput || appliedPages.current.has(response.input)) return;
    appliedPages.current.add(response.input);
    const currentReplay = replay.current;
    if (currentReplay?.generation === generation) {
      const pages = [...currentReplay.pages, response.result];
      if (pages.length < currentReplay.targetDepth && response.result.members.pageInfo.hasMore) {
        replay.current = { ...currentReplay, pages };
        setCursor(response.result.members.pageInfo.nextCursor ?? undefined);
        return;
      }
      const items = pages.flatMap(({ members }) => members.items);
      currentReplay.complete();
      replay.current = undefined;
      setState({
        depth: pages.length,
        grouped: response.result.grouped,
        items: [...new Map(items.map((item) => [item.entityId, item])).values()],
        pageInfo: response.result.members.pageInfo,
      });
      return;
    }
    setState((current) => {
      const items = current?.items ?? [];
      const merged = [...new Map([...items, ...response.result.members.items].map((item) => [item.entityId, item])).values()];
      return {
        items: merged,
        grouped: response.result.grouped,
        pageInfo: response.result.members.pageInfo,
        depth: (current?.depth ?? 0) + 1,
      };
    });
  }, [generation, page.data, queryInput]);
  useEffect(() => {
    if (!page.isError || replay.current?.generation !== generation) return;
    replay.current.complete();
    replay.current = undefined;
  }, [generation, page.isError]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const total = state?.grouped.reduce((sum, group) => sum + group.count, 0) ?? 0;
  return (
    <PluginScreenFrame title="Collection dashboard">
      <div className="flex flex-col gap-5 text-text" data-domain-presentations={importedDomainPresentations.length}>
        <ShowProgress name="Dashboard show summary" totalEpisodes={1} watchedEpisodes={0} />
        <section aria-labelledby="collection-summary">
          <h2 id="collection-summary" className="font-display text-xl">Collection summary</h2>
          <p>{total} total</p>
          <p>{state?.items.filter((item) => item.populationStatus === "pending" || item.translationStatus === "pending").length ?? 0} syncing</p>
          {state?.grouped.map((group) => (
            <p key={JSON.stringify([group.ownerPluginId, group.schemaSlug])}>{group.count} {schemaLabel(group)}</p>
          ))}
        </section>
        {!state && page.status === "pending" ? <StatusMessage tone="pending">Loading collection...</StatusMessage> : null}
        {page.status === "error" ? <StatusMessage tone="error">Collection failed to load.</StatusMessage> : null}
        {state ? (
          <>
            <EntityResults layout="list" references={state.items} viewContext={{ collectionId }} />
            {state.pageInfo.hasMore && state.pageInfo.nextCursor ? (
              <Button type="button" variant="secondary" onClick={() => setCursor(state.pageInfo.nextCursor ?? undefined)}>
                Load next page
              </Button>
            ) : null}
          </>
        ) : null}
        <PokemonPicker />
        <section aria-labelledby="fixture-greeting">
          <h2 id="fixture-greeting" className="font-display text-lg">Fixture operation</h2>
          <Button type="button" onClick={() => greeting.mutate()}>Invoke fixture greeting</Button>
          {greeting.data ? <StatusMessage tone="success">{greeting.data.greeting}</StatusMessage> : null}
        </section>
      </div>
    </PluginScreenFrame>
  );
};

export default function Page() {
  const decoded = Schema.decodeUnknownResult(Settings)(usePageContext().settings);
  return Result.isFailure(decoded)
    ? <StatusMessage tone="error">Invalid collection workflow settings.</StatusMessage>
    : <CollectionPage {...decoded.success} />;
}
`;

const clientRendererSettingsSchema = {
	unknownKeys: "strict",
	fields: {
		label: { type: "string", label: "Label", description: "Text displayed by the renderer" },
	},
} satisfies ClientRendererDefinition["settingsSchema"];

export const encodeClientRendererSource = (source: string) =>
	Encoding.encodeBase64(new TextEncoder().encode(source));

export const buildClientRendererDefinition = (
	overrides: Partial<ClientRendererDefinition> = {},
): ClientRendererDefinition => ({
	pluginDependencies: [],
	entry: "client/page.tsx",
	automaticEntityPresentations: false,
	settingsSchema: clientRendererSettingsSchema,
	files: [{ path: "client/page.tsx", content: encodeClientRendererSource(clientRendererSource) }],
	...overrides,
});

export const buildComposedClientRendererDefinition = (
	overrides: Partial<ClientRendererDefinition> = {},
): ClientRendererDefinition =>
	buildClientRendererDefinition({
		pluginDependencies: [PluginSlug.make("fixture"), PluginSlug.make("media")],
		files: [
			{
				path: "client/page.tsx",
				content: encodeClientRendererSource(composedClientRendererSource),
			},
		],
		...overrides,
	});

export const buildNamedDataSourcesRendererDefinition = () =>
	buildClientRendererDefinition({
		files: [
			{
				path: "client/page.tsx",
				content: encodeClientRendererSource(namedDataSourcesRendererSource),
			},
		],
	});

export const buildCollectionWorkflowRendererDefinition = () =>
	buildClientRendererDefinition({
		automaticEntityPresentations: true,
		pluginDependencies: [
			PluginSlug.make("fixture"),
			PluginSlug.make("fitness"),
			PluginSlug.make("media"),
		],
		files: [
			{
				path: "client/page.tsx",
				content: encodeClientRendererSource(collectionWorkflowRendererSource),
			},
		],
		settingsSchema: {
			unknownKeys: "strict",
			fields: {
				collectionId: {
					type: "string",
					label: "Collection ID",
					validation: { minLength: 1, required: true },
					description: "Collection displayed by the renderer",
				},
				pageSize: {
					type: "integer",
					label: "Page size",
					description: "Collection entities displayed per page",
					validation: { minimum: 1, maximum: 100, required: true },
				},
			},
		},
	});

export const createClientRenderer = (
	client: Client,
	overrides: Partial<CreateRendererPayload> = {},
) =>
	client.call((contract) =>
		contract.clientPages.createRenderer({
			payload: {
				slug: `renderer-${crypto.randomUUID()}`,
				name: `Renderer ${crypto.randomUUID()}`,
				draftDefinition: buildClientRendererDefinition(),
				...overrides,
			},
		}),
	);

export const listClientRenderers = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => clientRenderersRecipe({ after, limit: 100 }));

export const getClientRenderer = (client: Client, rendererId: RendererId) =>
	executeRyotQLRecipe(client, clientRendererRecipe({ id: rendererId }));

export const replaceClientRendererDraft = (
	client: Client,
	rendererId: ReplaceRendererDraftRequest["params"]["rendererId"],
	payload: ReplaceRendererDraftRequest["payload"],
) =>
	client.call((contract) =>
		contract.clientPages.replaceRendererDraft({ payload, params: { rendererId } }),
	);

export const publishClientRenderer = (
	client: Client,
	rendererId: PublishRendererRequest["params"]["rendererId"],
	expectedDraftRevision: PublishRendererRequest["payload"]["expectedDraftRevision"],
) =>
	client.call((contract) =>
		contract.clientPages.publishRenderer({
			params: { rendererId },
			payload: { expectedDraftRevision },
		}),
	);

export const deleteClientRenderer = (client: Client, rendererId: RendererId) =>
	client.call((contract) => contract.clientPages.deleteRenderer({ params: { rendererId } }));

export const prepareClientPage = (client: Client, slug: SavedViewClientPageTarget["slug"]) =>
	client.call((contract) =>
		contract.clientPages.prepare({ payload: { target: { slug, kind: "saved-view" } } }),
	);

export const checkClientPageFreshness = (
	client: Client,
	identity: CheckClientPageFreshnessRequest["payload"]["identity"],
) => client.call((contract) => contract.clientPages.checkFreshness({ payload: { identity } }));

export const buildRendererSavedViewPayload = (
	rendererId: CustomRendererId,
	settings: RendererSavedViewPayload["settings"],
	overrides: Partial<Omit<RendererSavedViewPayload, "renderer" | "settings">> = {},
): RendererSavedViewPayload => ({
	settings,
	dataSources: null,
	icon: "layout-dashboard",
	renderer: { rendererId, kind: "custom" },
	name: `Renderer view ${crypto.randomUUID()}`,
	...overrides,
});

export const createRendererSavedView = (
	client: Client,
	rendererId: Parameters<typeof buildRendererSavedViewPayload>[0],
	settings: RendererSavedViewPayload["settings"],
	overrides: Parameters<typeof buildRendererSavedViewPayload>[2] = {},
) => {
	const payload = buildRendererSavedViewPayload(rendererId, settings, overrides);
	return client
		.call((contract) => contract.savedViews.create({ payload }))
		.pipe(Effect.map((result) => ({ ...result, slug: normalizeSlug(payload.name) })));
};

export const buildEntityBrowserSavedViewPayload = (
	overrides: Partial<KernelSavedViewPayload> = {},
	entityIds: readonly string[] = [],
	entitySchemaSlug?: string,
	ownerPluginId?: string,
): KernelSavedViewPayload => {
	const entity = table("entity", "browserEntity");
	const predicates = [
		...(entityIds.length === 0
			? []
			: [
					inArray(
						column(entity, "id"),
						entityIds.map((entityId) => literal(entityId)),
					),
				]),
		...(entitySchemaSlug === undefined
			? []
			: [eq(column(entity, "entitySchemaSlug"), literal(entitySchemaSlug))]),
		...(ownerPluginId === undefined
			? []
			: [eq(column(entity, "entitySchemaPluginId"), literal(ownerPluginId))]),
	];
	return {
		icon: "library",
		name: `Entity browser ${crypto.randomUUID()}`,
		renderer: { kind: "kernel", name: "entity-browser" },
		settings: {
			pageSize: 2,
			addAction: null,
			sortChoices: [],
			searchFields: [],
			tableColumns: null,
			defaultLayout: "grid",
			sourceName: "entities",
			layouts: ["grid", "list"],
			entityIdField: "entityId",
			ownerPluginIdField: "ownerPluginId",
			entitySchemaSlugField: "entitySchemaSlug",
		},
		dataSources: document({
			entities: rows(entity, {
				limit: 2,
				...(predicates.length === 0
					? {}
					: { where: predicates.length === 1 ? predicates[0] : and(...predicates) }),
				orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
				fields: [
					field("entityId", column(entity, "id")),
					field("name", column(entity, "name")),
					field("ownerPluginId", column(entity, "entitySchemaPluginId")),
					field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				],
			}),
		}),
		...overrides,
	};
};

export const createEntityBrowserSavedView = (
	client: Client,
	overrides: Partial<KernelSavedViewPayload> = {},
	entityIds: readonly string[] = [],
	entitySchemaSlug?: string,
	ownerPluginId?: string,
) => {
	const payload = buildEntityBrowserSavedViewPayload(
		overrides,
		entityIds,
		entitySchemaSlug,
		ownerPluginId,
	);
	return client
		.call((contract) => contract.savedViews.create({ payload }))
		.pipe(Effect.map((result) => Object.assign(result, { slug: normalizeSlug(payload.name) })));
};

export const createResultsTableSavedView = (
	client: Client,
	input: { readonly entityId: string; readonly eventSchemaSlug: string },
) => {
	const event = table("event", "resultEvent");
	const entity = table("entity", "resultEntity");
	return client.call((contract) =>
		contract.savedViews.create({
			payload: {
				icon: "table",
				name: `Results table ${crypto.randomUUID()}`,
				renderer: { kind: "kernel", name: "results-table" },
				settings: {
					pageSize: 10,
					sourceName: "events",
					rowKeyFields: ["entityId", "occurredAt"],
					entityLink: { entityIdField: "entityId" },
					columns: [
						{ field: "note", label: "Note", displayKind: "text" },
						{ label: "Occurred", field: "occurredAt", displayKind: "date" },
						{ field: "missing", label: "Missing", displayKind: "managed-asset" },
					],
				},
				dataSources: document({
					events: rows(event, {
						limit: 10,
						orderBy: [ascending(column(event, "occurredAt"))],
						joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
						where: and(
							eq(column(event, "entityId"), literal(input.entityId)),
							eq(column(event, "eventSchemaSlug"), literal(input.eventSchemaSlug)),
						),
						fields: [
							field("entityId", column(entity, "id")),
							field("occurredAt", column(event, "occurredAt")),
							field("note", jsonPath(column(event, "properties"), "note")),
							field("missing", jsonPath(column(event, "properties"), "missing")),
						],
					}),
				}),
			},
		}),
	);
};

export const buildNamedDataSources = (
	entityIds: readonly string[],
	range: { readonly startAt: string; readonly endAt: string },
) => {
	const entity = table("entity", "structuredEntity");
	const selected = inArray(
		column(entity, "id"),
		entityIds.map((entityId) => literal(entityId)),
	);
	return document({
		timeline: timeSeries(entity, {
			...range,
			bucket: "day",
			where: selected,
			measure: { function: "count" },
			time: column(entity, "createdAt"),
		}),
		native: rows(entity, {
			limit: 10,
			where: selected,
			orderBy: [ascending(column(entity, "name"))],
			fields: [field("name", column(entity, "name"))],
		}),
		grouped: aggregate(entity, {
			limit: 10,
			where: selected,
			orderBy: [groupAscending("schema")],
			measures: [measure("count", { function: "count" })],
			groupBy: [field("schema", column(entity, "entitySchemaSlug"))],
		}),
	});
};
