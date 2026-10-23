import type { ContractPayload, ContractRequest } from "@ryot-app/contract/client";
import {
	definitionKey,
	definitionOwner,
	type PluginPackageReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { fixturePlugin } from "@ryot-app/fixture-plugin";
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
import { normalizeSlug } from "@ryot-app/ts-utils/slug";
import { Effect } from "effect";

import type { Client } from "./auth";
import { getEntity } from "./entities";
import { findPluginInstallationByPackage } from "./plugins";

type CreateSavedViewPayload = ContractPayload<"savedViews", "create">;
type PrepareClientPageRequest = ContractRequest<"pages", "prepare">;
type CheckClientPageFreshnessRequest = ContractRequest<"pages", "checkFreshness">;
type PluginSavedViewPayload = Extract<CreateSavedViewPayload, { renderer: { kind: "plugin" } }>;
type KernelSavedViewPayload = Extract<
	CreateSavedViewPayload,
	{ renderer: { name: "collection-browser" | "entity-browser" } }
>;
type SubjectSchemas = KernelSavedViewPayload["settings"]["subject"]["schemas"];
type SavedViewClientPageTarget = Extract<
	PrepareClientPageRequest["payload"]["target"],
	{ kind: "saved-view" }
>;

export const findPluginIdByPackage = (
	client: Client,
	reference: PluginPackageReference & { readonly scope: "user" },
) => {
	if (!client.userId) {
		throw new Error("Cannot find a user plugin without an authenticated user");
	}
	return findPluginInstallationByPackage(client, reference).pipe(
		Effect.map((installation) => installation.pluginId),
	);
};

export const prepareClientPage = (
	client: Client,
	reference: SavedViewClientPageTarget["reference"],
) =>
	client.call((contract) =>
		contract.pages.prepare({ payload: { target: { reference, kind: "saved-view" } } }),
	);

export const checkClientPageFreshness = (
	client: Client,
	identity: CheckClientPageFreshnessRequest["payload"]["identity"],
) => client.call((contract) => contract.pages.checkFreshness({ payload: { identity } }));

export const buildPluginSavedViewPayload = (
	renderer: PluginSavedViewPayload["renderer"],
	settings: PluginSavedViewPayload["settings"],
	overrides: Partial<Omit<PluginSavedViewPayload, "renderer" | "settings">> = {},
): PluginSavedViewPayload => ({
	settings,
	renderer,
	dataSources: null,
	icon: "layout-dashboard",
	name: `Plugin view ${crypto.randomUUID()}`,
	...overrides,
});

export const createPluginSavedView = (
	client: Client,
	renderer: Parameters<typeof buildPluginSavedViewPayload>[0],
	settings: Parameters<typeof buildPluginSavedViewPayload>[1],
	overrides: Parameters<typeof buildPluginSavedViewPayload>[2] = {},
) => {
	const payload = buildPluginSavedViewPayload(renderer, settings, overrides);
	return client
		.call((contract) => contract.savedViews.create({ payload }))
		.pipe(
			Effect.map((result) => ({
				...result,
				slug: normalizeSlug(payload.name),
				reference: { savedViewId: result.id, kind: "custom" as const },
			})),
		);
};

const defaultSubjectSchemas: SubjectSchemas = [
	{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("collection") },
];

export const buildEntityBrowserSavedViewPayload = (
	overrides: Partial<KernelSavedViewPayload> = {},
	entityIds: readonly string[] = [],
	schemas: SubjectSchemas = defaultSubjectSchemas,
): KernelSavedViewPayload => {
	const entity = table("entity", "browserEntity");
	const predicates =
		entityIds.length === 0
			? []
			: [
					inArray(
						column(entity, "id"),
						entityIds.map((entityId) => literal(entityId)),
					),
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
			subject: { schemas, entityAlias: "browserEntity" },
		},
		dataSources: document({
			entities: rows(entity, {
				limit: 2,
				...(predicates.length === 0
					? {}
					: { where: predicates.length === 1 ? predicates[0] : and(...predicates) }),
				orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
				fields: [
					field("name", column(entity, "name")),
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
	schemas?: SubjectSchemas,
) =>
	Effect.gen(function* () {
		const entities = yield* Effect.forEach(entityIds, (entityId) => getEntity(client, entityId));
		const unique = new Map(
			entities.map(({ entitySchemaSlug, entitySchemaPluginId }) => {
				const owner = definitionOwner(entitySchemaPluginId);
				return [
					definitionKey("entity", owner, entitySchemaSlug),
					{ owner, slug: entitySchemaSlug },
				] as const;
			}),
		);
		const [first, ...rest] = unique.values();
		const subject: SubjectSchemas =
			schemas ?? (first === undefined ? defaultSubjectSchemas : [first, ...rest]);
		const payload = buildEntityBrowserSavedViewPayload(overrides, entityIds, subject);
		const result = yield* client.call((contract) => contract.savedViews.create({ payload }));
		return {
			...result,
			slug: normalizeSlug(payload.name),
			reference: { savedViewId: result.id, kind: "custom" as const },
		};
	});

export const createResultsTableSavedView = (
	client: Client,
	input: { readonly entityId: string; readonly eventSchemaSlug: string },
) => {
	const event = table("event", "resultEvent");
	const entity = table("entity", "resultEntity");
	return client
		.call((contract) =>
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
						filterFields: [
							{ key: "note", type: "text", label: "Note", field: "note", kind: "value" },
						],
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
		)
		.pipe(
			Effect.map((result) =>
				Object.assign({}, result, {
					reference: { savedViewId: result.id, kind: "custom" as const },
				}),
			),
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

export const collectionWorkflowRendererSource = `
import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { EntityResults, PluginPackageId, usePageContext } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotMutation, createRyotQuery, nextPageCursor, paginationItems, useRyotInfiniteQuery, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { and, ascending, column, defineRecipe, eq, groupAscending, join, literal, selectedAggregate, selectedField, selectedMeasure, selectedRows, table, type Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, LoadMoreButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import PokemonPicker from "@ryot-app/plugins/fixture/pokemon-picker";
import WorkoutRowPresentation from "@ryot-app/plugins/fitness/workout-row";
import ShowProgress from "@ryot-app/plugins/media/show-progress";
import ShowRowPresentation from "@ryot-app/plugins/media/show-row";

const Settings = Schema.Struct({ collectionId: Schema.String, pageSize: Schema.Number });
const Greeting = Schema.Struct({ greeting: Schema.String });
const importedDomainPresentations = [ShowRowPresentation, WorkoutRowPresentation];
type CollectionPageInput = {
  readonly collectionId: string;
  readonly pageSize: number;
  readonly after: string | undefined;
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
          ownerPackageId: selectedField(column(ownerPlugin, "packageId"), Schema.NullOr(Schema.String)),
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
const collectionPageQuery = createRyotQuery<CollectionPageInput, CollectionPageData>(
  ({ client, input }) => client.data.query(collectionPageRecipe(input)),
  { cancelOnUnmount: true },
);
const greetingMutation = createRyotMutation(({ client }) => client.operations.invoke({
  slug: "greet",
  input: { name: "Media collection page" },
  inputSchema: Schema.Struct({ name: Schema.String }),
  output: Greeting,
  packageId: PluginPackageId.make(${JSON.stringify(fixturePlugin.metadata.packageId)}),
}));

const schemaLabel = (group: CollectionPageData["grouped"][number]) => {
  if (group.ownerPackageId === ${JSON.stringify(fixturePlugin.metadata.packageId)} && group.schemaSlug === "pokemon") return "Pokemon";
  if (group.ownerPluginId === null && group.schemaSlug === "collection") return "Collections";
  return group.ownerPluginName === null ? group.schemaSlug : group.ownerPluginName + " / " + group.schemaSlug;
};

const CollectionPage = ({ collectionId, pageSize }: typeof Settings.Type) => {
  const page = useRyotInfiniteQuery(collectionPageQuery, { collectionId, pageSize }, {
    initialPageParam: undefined,
    getPageInput: (input, after: string | undefined) => ({ ...input, after }),
    getNextPageParam: (page) => nextPageCursor(page.members),
  });
  const last = page.data;
  const grouped = last?.grouped;
  const items = paginationItems(page.pages, (page) => page.members.items, (item) => item.entityId);
  const greeting = useRyotMutation(greetingMutation);
  const total = grouped?.reduce((sum, group) => sum + group.count, 0) ?? 0;
  return (
    <PluginScreenFrame title="Collection dashboard">
      <div className="flex flex-col gap-5 text-text" data-domain-presentations={importedDomainPresentations.length}>
        <ShowProgress name="Dashboard show summary" totalEpisodes={1} watchedEpisodes={0} />
        <section aria-labelledby="collection-summary">
          <h2 id="collection-summary" className="font-display text-xl">Collection summary</h2>
          <p>{total} total</p>
          <p>{items.filter((item) => item.populationStatus === "pending" || item.translationStatus === "pending").length} syncing</p>
          {grouped?.map((group) => (
            <p key={JSON.stringify([group.ownerPluginId, group.schemaSlug])}>{group.count} {schemaLabel(group)}</p>
          ))}
        </section>
        {!last && page.status === "pending" ? <StatusMessage tone="pending">Loading collection...</StatusMessage> : null}
        {page.status === "error" ? <StatusMessage tone="error">Collection failed to load.</StatusMessage> : null}
        {last ? (
          <>
            <EntityResults layout="list" references={items} viewContext={{ collectionId }} />
            {page.hasNextPage ? (
              <LoadMoreButton
                label="Load next page"
                isFetchingNextPage={page.isFetchingNextPage}
                disabled={page.isFetching}
                onClick={page.fetchNextPage}
              />
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
