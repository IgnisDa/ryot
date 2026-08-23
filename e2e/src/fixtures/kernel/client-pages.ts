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
import { Encoding } from "effect";

import type { Client } from "./auth";

type CreateSavedViewRequest = ContractRequest<"savedViews", "create">;
type PrepareClientPageRequest = ContractRequest<"clientPages", "prepare">;
type CreateRendererRequest = ContractRequest<"clientPages", "createRenderer">;
type PublishRendererRequest = ContractRequest<"clientPages", "publishRenderer">;
type CreateClientPageSessionRequest = ContractRequest<"clientPages", "createSession">;
type ReplaceRendererDraftRequest = ContractRequest<"clientPages", "replaceRendererDraft">;

type CreateRendererPayload = CreateRendererRequest["payload"];
type RendererId = ContractSuccess<"clientPages", "getRenderer">["id"];
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

export const clientRendererSource = `
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

export const composedClientRendererSource = `
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

export const namedDataSourcesRendererSource = `
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

export const clientRendererSettingsSchema = {
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
	client.call((contract) => contract.clientPages.listRenderers());

export const getClientRenderer = (client: Client, rendererId: RendererId) =>
	client.call((contract) => contract.clientPages.getRenderer({ params: { rendererId } }));

export const replaceClientRendererDraft = (
	client: Client,
	rendererId: ReplaceRendererDraftRequest["params"]["rendererId"],
	payload: ReplaceRendererDraftRequest["payload"],
) =>
	client.call((contract) =>
		contract.clientPages.replaceRendererDraft({ params: { rendererId }, payload }),
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

export const prepareClientPage = (
	client: Client,
	savedViewId: SavedViewClientPageTarget["savedViewId"],
) =>
	client.call((contract) =>
		contract.clientPages.prepare({ payload: { target: { kind: "saved-view", savedViewId } } }),
	);

export const createClientPageSession = (
	client: Client,
	identity: CreateClientPageSessionRequest["payload"]["identity"],
) => client.call((contract) => contract.clientPages.createSession({ payload: { identity } }));

export const renewClientPageSession = (client: Client, sessionId: string) =>
	client.call((contract) => contract.clientPages.renewSession({ params: { sessionId } }));

export const revokeClientPageSession = (client: Client, sessionId: string) =>
	client.call((contract) => contract.clientPages.revokeSession({ params: { sessionId } }));

export const buildRendererSavedViewPayload = (
	rendererId: CustomRendererId,
	settings: RendererSavedViewPayload["settings"],
	overrides: Partial<Omit<RendererSavedViewPayload, "renderer" | "settings">> = {},
): RendererSavedViewPayload => ({
	settings,
	dataSources: null,
	icon: "layout-dashboard",
	renderer: { kind: "custom", rendererId },
	name: `Renderer view ${crypto.randomUUID()}`,
	...overrides,
});

export const createRendererSavedView = (
	client: Client,
	rendererId: Parameters<typeof buildRendererSavedViewPayload>[0],
	settings: RendererSavedViewPayload["settings"],
	overrides: Parameters<typeof buildRendererSavedViewPayload>[2] = {},
) =>
	client.call((contract) =>
		contract.savedViews.create({
			payload: buildRendererSavedViewPayload(rendererId, settings, overrides),
		}),
	);

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
) =>
	client.call((contract) =>
		contract.savedViews.create({
			payload: buildEntityBrowserSavedViewPayload(
				overrides,
				entityIds,
				entitySchemaSlug,
				ownerPluginId,
			),
		}),
	);

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
						{ field: "occurredAt", label: "Occurred", displayKind: "date" },
						{ field: "missing", label: "Missing", displayKind: "managed-asset" },
					],
				},
				dataSources: document({
					events: rows(event, {
						limit: 10,
						joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
						where: and(
							eq(column(event, "entityId"), literal(input.entityId)),
							eq(column(event, "eventSchemaSlug"), literal(input.eventSchemaSlug)),
						),
						orderBy: [ascending(column(event, "occurredAt"))],
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
		timeline: timeSeries(entity, {
			...range,
			bucket: "day",
			where: selected,
			measure: { function: "count" },
			time: column(entity, "createdAt"),
		}),
	});
};
