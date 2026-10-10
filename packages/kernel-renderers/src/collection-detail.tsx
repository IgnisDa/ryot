import { DateTime, Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePluginLocation } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyot, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, IconButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	collectionHeaderRecipe,
	type CollectionHeaderResult,
	collectionMemberFilterFields,
	collectionMembersAggregateRecipe,
	type CollectionMembersAggregateResult,
	collectionMembersCountRecipe,
	CollectionMemberSort,
	collectionMembersRecipe,
	collectionMemberTableColumns,
} from "@ryot-app/ryotql-recipes/collections";
import { NullableFilter } from "@ryot-app/ryotql-recipes/filters";
import { useEffect, useEffectEvent, useState } from "react";

import { BrowserInlineError } from "./browser-states";
import { type BrowserQueryPage, EntityBrowserController } from "./entity-browser-controller";
import { useHostScreen } from "./host-screen";

const QueryInput = Schema.Struct({
	filter: NullableFilter,
	searchText: Schema.String,
	cursor: Schema.NullOr(Schema.String),
	sortChoice: Schema.Union([Schema.Literal(""), CollectionMemberSort]),
});
const decodeQueryInput = Schema.decodeUnknownSync(Schema.fromJsonString(QueryInput));

const CountInput = Schema.Struct({ filter: NullableFilter, searchText: Schema.String });
const decodeCountInput = Schema.decodeUnknownSync(Schema.fromJsonString(CountInput));

const headerQuery = createRyotQuery<string, CollectionHeaderResult>(({ input, client }) =>
	client.data.query(collectionHeaderRecipe({ collectionId: input })),
);
const groupsQuery = createRyotQuery<string, CollectionMembersAggregateResult>(({ input, client }) =>
	client.data.query(collectionMembersAggregateRecipe({ collectionId: input })),
);
const totalQuery = createRyotQuery<string, number>(({ input, client }) =>
	client.data.query(collectionMembersCountRecipe({ collectionId: input })),
);

type CollectionFilterFields = ReturnType<typeof collectionMemberFilterFields>;

const CollectionCount = ({
	filter,
	onTotal,
	searchText,
	collectionId,
	filterFields,
}: {
	readonly collectionId: string;
	readonly searchText: string;
	readonly filter: typeof NullableFilter.Type;
	readonly filterFields: CollectionFilterFields;
	readonly onTotal: (total: number | undefined) => void;
}) => {
	const [query] = useState(() =>
		createRyotQuery<string, number>(({ client, input: serialized }) =>
			Effect.gen(function* () {
				const { filter: applied, searchText: search } = decodeCountInput(serialized);
				const now = yield* DateTime.now;
				return yield* client.data.query(
					collectionMembersCountRecipe({
						collectionId,
						filterFields,
						...(search === "" ? {} : { searchText: search }),
						...(applied === null ? {} : { now, filter: applied }),
					}),
				);
			}),
		),
	);
	const result = useRyotQuery(query, JSON.stringify({ filter, searchText }));
	const report = useEffectEvent((total: number | undefined) => onTotal(total));
	useEffect(() => report(result.data), [result.data]);
	if (result.isPending) {
		return (
			<Button disabled variant="ghost" className="text-sm text-accent-text">
				Counting...
			</Button>
		);
	}
	if (result.isError) {
		return (
			<Button variant="ghost" onClick={result.refetch} className="text-sm text-accent-text">
				Retry count
			</Button>
		);
	}
	return null;
};

const CollectionBrowser = ({
	total,
	groups,
	header,
	identityKey,
	collectionId,
}: {
	readonly total: number;
	readonly identityKey: string;
	readonly collectionId: string;
	readonly header: CollectionHeaderResult;
	readonly groups: CollectionMembersAggregateResult;
}) => {
	const ryot = useRyot();
	const openScreen = useHostScreen();
	const editCollection = () =>
		openScreen(ryot.screens.editCollection({ collectionId }), (outcome) => {
			if (outcome.kind === "deleted") {
				ryot.navigation.replace({
					kind: "saved-view",
					reference: { kind: "kernel", slug: "collections" },
				});
			}
		});
	const memberDetails = (entityId: string) =>
		openScreen(ryot.screens.addToCollection({ entityId, collectionId }));
	const membershipPropertiesSchema = header?.membershipPropertiesSchema ?? null;
	const filterFields = collectionMemberFilterFields({ groups, membershipPropertiesSchema });
	const [query] = useState(() =>
		createRyotQuery<string, BrowserQueryPage<null>>(
			({ input, client }) =>
				Effect.gen(function* () {
					const { filter, searchText, sortChoice, cursor: after } = decodeQueryInput(input);
					const now = yield* DateTime.now;
					const members = yield* client.data.query(
						collectionMembersRecipe({
							collectionId,
							filterFields,
							membershipPropertiesSchema,
							...(searchText === "" ? {} : { searchText }),
							...(sortChoice === "" ? {} : { sort: sortChoice }),
							...(after === null ? {} : { after }),
							...(filter === null ? {} : { now, filter }),
						}),
					);
					return { meta: null, result: members };
				}),
			{ cancelOnUnmount: true },
		),
	);
	return (
		<EntityBrowserController
			query={query}
			icon="library"
			knownTotal={total}
			defaultLayout="grid"
			identityKey={identityKey}
			filterFields={filterFields}
			viewContext={{ collectionId }}
			layouts={["grid", "list", "table"]}
			defaultSortLabel="Collection order"
			errorTitle="Collection unavailable"
			emptyMessage="This collection is empty."
			name={() => header?.name ?? "Collection"}
			errorMessage="The collection could not be loaded."
			tableColumns={collectionMemberTableColumns(membershipPropertiesSchema)}
			headerAction={{ icon: "pencil", run: editCollection, label: "Edit collection" }}
			sortChoices={[
				{ label: "Name A-Z", value: "name-asc" },
				{ label: "Name Z-A", value: "name-desc" },
				{ label: "Recently added", value: "recently-added" },
				{ label: "Oldest added", value: "oldest-added" },
			]}
			renderItemActions={(item) => (
				<IconButton
					size="sm"
					onClick={() => memberDetails(item.entityId)}
					label={`Collection details for ${item.name ?? "item"}`}
				>
					<AppIcon size={16} name="ellipsis" />
				</IconButton>
			)}
			// oxlint-disable-next-line react/no-unstable-nested-components -- The slot needs this collection ID.
			count={({ filter, onTotal, searchText: search }) => (
				<CollectionCount
					onTotal={onTotal}
					searchText={search}
					filter={filter ?? null}
					collectionId={collectionId}
					filterFields={filterFields}
					key={JSON.stringify([collectionId, search, filter])}
				/>
			)}
			renderSummary={() => (
				<>
					{header?.description ? (
						<p className="text-sm text-text-muted">{header.description}</p>
					) : null}
					<section
						aria-label="Collection summary"
						className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted"
					>
						<strong className="font-semibold text-text">{total.toLocaleString()} total</strong>
						{groups.items.map((group) => (
							<span key={JSON.stringify([group.ownerPluginId, group.entitySchemaSlug])}>
								{group.count.toLocaleString()} {group.typeLabel}
							</span>
						))}
						{groups.pageInfo?.hasMore && <span>More types not shown</span>}
					</section>
				</>
			)}
		/>
	);
};

const CollectionDetail = ({ collectionId }: { readonly collectionId: string }) => {
	const header = useRyotQuery(headerQuery, collectionId);
	const groups = useRyotQuery(groupsQuery, collectionId);
	const total = useRyotQuery(totalQuery, collectionId);
	if (header.data === undefined || groups.data === undefined || total.data === undefined) {
		const failed = [header, groups, total].filter(({ isError }) => isError);
		return (
			<PluginScreenFrame title="Collection">
				{failed.length === 0 ? null : (
					<BrowserInlineError
						title="Collection unavailable"
						message="The collection could not be loaded."
						onRetry={() => failed.forEach(({ refetch }) => refetch())}
					/>
				)}
			</PluginScreenFrame>
		);
	}
	const schemaKey = JSON.stringify([
		header.data?.membershipPropertiesSchema ?? null,
		groups.data.items.length > 0,
	]);
	const identityKey = JSON.stringify([collectionId, schemaKey]);
	return (
		<CollectionBrowser
			key={identityKey}
			total={total.data}
			header={header.data}
			groups={groups.data}
			identityKey={identityKey}
			collectionId={collectionId}
		/>
	);
};

export default function CollectionDetailPage() {
	const location = usePluginLocation();
	return location.kind !== "entity" ? (
		<PluginScreenFrame title="Collection">
			<StatusMessage tone="error">This collection page is invalid.</StatusMessage>
		</PluginScreenFrame>
	) : (
		<CollectionDetail collectionId={location.entityId} />
	);
}
