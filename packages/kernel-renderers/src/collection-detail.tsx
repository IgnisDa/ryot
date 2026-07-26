import { Result, Schema } from "@ryot-app/client-sdk/effect";
import { EntityResults, usePageRefresh, usePluginLocation } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	groupAscending,
	join,
	literal,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/client-sdk/ryotql";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import { useEffect, useEffectEvent, useRef, useState } from "react";

const syncStatus = (status: string): "pending" | "ready" | "none" =>
	status === "pending" || status === "ready" ? status : "none";

const collectionPageRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly collectionId: string }) => {
		const membership = table("relationship", "collectionMembership");
		const entity = table("entity", "collectionEntity");
		const ownerPlugin = table("plugin", "ownerPlugin");
		const collection = table("entity", "collectionHeader");
		const joins = [
			join("inner", entity, eq(column(membership, "sourceEntityId"), column(entity, "id"))),
			join(
				"left",
				ownerPlugin,
				eq(column(entity, "entitySchemaPluginId"), column(ownerPlugin, "id")),
			),
		];
		const where = and(
			eq(column(membership, "targetEntityId"), literal(input.collectionId)),
			eq(column(membership, "relationshipSchemaSlug"), literal("member-of")),
		);
		return {
			map: ({ grouped, members, collection: header }) =>
				Result.succeed({
					header: header.items,
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
			queries: {
				collection: selectedRows(collection, {
					limit: 1,
					orderBy: [ascending(column(collection, "id"))],
					where: eq(column(collection, "id"), literal(input.collectionId)),
					selection: {
						id: selectedField(column(collection, "id"), Schema.String),
						name: selectedField(column(collection, "name"), Schema.NullOr(Schema.String)),
					},
				}),
				grouped: selectedAggregate(membership, {
					joins,
					where,
					limit: 100,
					orderBy: [groupAscending("ownerPluginId"), groupAscending("schemaSlug")],
					measures: { count: selectedMeasure({ function: "count" }, Schema.Number) },
					groupBy: {
						schemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						ownerPluginName: selectedField(
							column(ownerPlugin, "name"),
							Schema.NullOr(Schema.String),
						),
						ownerPluginSlug: selectedField(
							column(ownerPlugin, "slug"),
							Schema.NullOr(Schema.String),
						),
						ownerPluginId: selectedField(
							column(entity, "entitySchemaPluginId"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
				members: selectedRows(membership, {
					joins,
					where,
					limit: 20,
					...(input.after === undefined ? {} : { after: input.after }),
					orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
					selection: {
						entityId: selectedField(column(entity, "id"), Schema.String),
						name: selectedField(column(entity, "name"), Schema.NullOr(Schema.String)),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						populationStatus: selectedField(column(entity, "populationStatus"), Schema.String),
						translationStatus: selectedField(column(entity, "translationStatus"), Schema.String),
						ownerPluginId: selectedField(
							column(entity, "entitySchemaPluginId"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
		};
	},
);

type CollectionPageData = Recipe.Success<typeof collectionPageRecipe>;
type CollectionQueryPage = { readonly input: string; readonly result: CollectionPageData };

const collectionPageQuery = createRyotQuery<string, CollectionQueryPage>(
	async ({ input, client, signal }) => {
		const [collectionId, after] = decodeQueryInput(input);
		return {
			input,
			result: await client.data.query(
				collectionPageRecipe({ collectionId, after: after ?? undefined }),
				{ signal },
			),
		};
	},
);

const schemaLabel = (group: CollectionPageData["grouped"][number]) => {
	if (group.ownerPluginId === null && group.schemaSlug === "collection") {
		return "Collections";
	}
	return group.ownerPluginName === null
		? group.schemaSlug
		: `${group.ownerPluginName} / ${group.schemaSlug}`;
};

type CollectionState = {
	readonly depth: number;
	readonly header: CollectionPageData["header"];
	readonly grouped: CollectionPageData["grouped"];
	readonly items: CollectionPageData["members"]["items"];
	readonly pageInfo: CollectionPageData["members"]["pageInfo"];
};

const QueryInput = Schema.Tuple([Schema.String, Schema.NullOr(Schema.String), Schema.Number]);

const decodeQueryInput = Schema.decodeUnknownSync(Schema.fromJsonString(QueryInput));

const CollectionDetail = ({ collectionId }: { readonly collectionId: string }) => {
	const [cursor, setCursor] = useState<string | null>(null);
	const [generation, setGeneration] = useState(0);
	const [state, setState] = useState<CollectionState | undefined>(undefined);
	const appliedInputs = useRef(new Set<string>());
	const refresh = useEffectEvent(
		() =>
			new Promise<void>((resolve) => {
				appliedInputs.current.clear();
				setCursor(null);
				setGeneration((current) => current + 1);
				resolve();
			}),
	);
	usePageRefresh(refresh);
	const queryInput = JSON.stringify([collectionId, cursor, generation]);
	const page = useRyotQuery(collectionPageQuery, queryInput, { refreshOnMutation: false });

	useEffect(() => {
		const response = page.data;
		if (!response || response.input !== queryInput || appliedInputs.current.has(response.input)) {
			return;
		}
		appliedInputs.current.add(response.input);
		const [decodedCollectionId, after] = decodeQueryInput(response.input);
		void decodedCollectionId;
		setState((current) => {
			const merged =
				after === null
					? response.result.members.items
					: [...(current?.items ?? []), ...response.result.members.items];
			const deduped = [...new Map(merged.map((item) => [item.entityId, item])).values()];
			return {
				items: deduped,
				header: response.result.header,
				grouped: response.result.grouped,
				depth: (current?.depth ?? 0) + 1,
				pageInfo: response.result.members.pageInfo,
			};
		});
	}, [page.data, queryInput]);

	const initial = state === undefined;
	const title = state?.header[0]?.name ?? "Collection";
	const total = state?.grouped.reduce((sum, group) => sum + group.count, 0) ?? 0;
	const references = (state?.items ?? []).map((item) => ({
		name: item.name,
		entityId: item.entityId,
		ownerPluginId: item.ownerPluginId,
		entitySchemaSlug: item.entitySchemaSlug,
		populationStatus: item.populationStatus,
		translationStatus: item.translationStatus,
	}));

	return (
		<PluginScreenFrame title={title}>
			<div className="flex flex-col gap-5 text-text">
				<section aria-labelledby="collection-summary">
					<h2 id="collection-summary" className="font-display text-xl">
						Collection summary
					</h2>
					<p>{total} total</p>
					{state?.grouped.map((group) => (
						<p key={JSON.stringify([group.ownerPluginId, group.schemaSlug])}>
							{group.count} {schemaLabel(group)}
						</p>
					))}
				</section>
				{initial && page.status === "pending" ? (
					<StatusMessage tone="pending">Loading collection...</StatusMessage>
				) : null}
				{initial && page.status === "error" ? (
					<StatusMessage tone="error">
						Collection failed to load.{" "}
						<Button variant="text" onClick={page.refetch}>
							Retry
						</Button>
					</StatusMessage>
				) : null}
				{!initial && references.length === 0 ? (
					<StatusMessage tone="success">This collection is empty.</StatusMessage>
				) : null}
				{references.length > 0 ? (
					<EntityResults layout="list" references={references} viewContext={{ collectionId }} />
				) : null}
				{state?.pageInfo.hasMore === true && state.pageInfo.nextCursor ? (
					<Button
						type="button"
						variant="secondary"
						onClick={() => setCursor(state.pageInfo.nextCursor ?? null)}
					>
						Load next page
					</Button>
				) : null}
				{!initial && page.status === "error" ? (
					<StatusMessage tone="error">
						More members could not be loaded.{" "}
						<Button variant="text" onClick={page.refetch}>
							Retry
						</Button>
					</StatusMessage>
				) : null}
			</div>
		</PluginScreenFrame>
	);
};

export default function CollectionDetailPage() {
	const location = usePluginLocation();
	if (location.kind !== "entity") {
		return (
			<PluginScreenFrame title="Collection">
				<StatusMessage tone="error">This collection page is invalid.</StatusMessage>
			</PluginScreenFrame>
		);
	}
	return <CollectionDetail collectionId={location.entityId} />;
}
