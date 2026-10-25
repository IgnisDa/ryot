import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePluginLocation } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyot, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, IconButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	type BrowseSchema,
	entitySchemaBrowseRecipe,
	type EntitySchemaBrowseResult,
} from "@ryot-app/ryotql-recipes/browse";
import {
	collectionHeaderRecipe,
	type CollectionHeaderResult,
	collectionMemberControls,
	type CollectionMemberFields,
	collectionMembersAggregateRecipe,
	type CollectionMembersAggregateResult,
	collectionMembersCountRecipe,
	collectionMembersRecipe,
	collectionMemberTableColumns,
} from "@ryot-app/ryotql-recipes/collections";
import { useEffect, useEffectEvent, useState } from "react";

import { BrowserInlineError } from "./browser-states";
import { CollectionOrder } from "./collection-order";
import {
	type BrowserQueryInput,
	type BrowserQueryPage,
	EntityBrowserController,
} from "./entity-browser-controller";
import { useHostScreen } from "./host-screen";

const headerQuery = createRyotQuery<string, CollectionHeaderResult>(({ input, client }) =>
	client.data.query(collectionHeaderRecipe({ collectionId: input })),
);
const groupsQuery = createRyotQuery<string, CollectionMembersAggregateResult>(({ input, client }) =>
	client.data.query(collectionMembersAggregateRecipe({ collectionId: input })),
);
const browseQuery = createRyotQuery<
	readonly Pick<BrowseSchema, "slug" | "pluginId">[],
	EntitySchemaBrowseResult
>(({ input, client }) => {
	const [first, ...rest] = input;
	return first === undefined
		? Effect.succeed([])
		: client.data.query(entitySchemaBrowseRecipe({ schemas: [first, ...rest] }));
});
const totalQuery = createRyotQuery<string, number>(({ input, client }) =>
	client.data.query(collectionMembersCountRecipe({ collectionId: input })),
);

const CollectionCount = ({
	filter,
	fields,
	onTotal,
	searchText,
	collectionId,
}: {
	readonly searchText: string;
	readonly collectionId: string;
	readonly fields: CollectionMemberFields;
	readonly filter: BrowserQueryInput["filter"];
	readonly onTotal: (total: number | undefined) => void;
}) => {
	const [query] = useState(() =>
		createRyotQuery<Pick<BrowserQueryInput, "filter" | "searchText">, number>(
			({ client, input: { filter: applied, searchText: search } }) =>
				Effect.gen(function* () {
					const now = yield* DateTime.now;
					return yield* client.data.query(
						collectionMembersCountRecipe({
							fields,
							collectionId,
							...(search === "" ? {} : { searchText: search }),
							...(applied === null ? {} : { now, filter: applied }),
						}),
					);
				}),
		),
	);
	const result = useRyotQuery(query, { filter, searchText });
	const report = useEffectEvent((total: number | undefined) => onTotal(total));
	useEffect(() => report(result.data), [result.data]);
	if (result.isPending) {
		return (
			<Button disabled variant="link">
				Counting...
			</Button>
		);
	}
	if (result.isError) {
		return (
			<Button variant="link" onClick={result.refetch}>
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
	schemas,
	onReorder,
	identityKey,
	collectionId,
}: {
	readonly total: number;
	readonly identityKey: string;
	readonly collectionId: string;
	readonly onReorder: () => void;
	readonly header: CollectionHeaderResult;
	readonly schemas: readonly BrowseSchema[];
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
	const fields = { groups, schemas, membershipPropertiesSchema };
	const { sortChoices, filterFields } = collectionMemberControls(fields);
	const [query] = useState(() =>
		createRyotQuery<BrowserQueryInput, BrowserQueryPage<null>>(
			({ client, input: { filter, searchText, sortChoice, cursor: after } }) =>
				Effect.gen(function* () {
					const now = yield* DateTime.now;
					const members = yield* client.data.query(
						collectionMembersRecipe({
							fields,
							collectionId,
							...(searchText === "" ? {} : { searchText }),
							...(sortChoice === "" ? {} : { sort: sortChoice }),
							...(after === null ? {} : { after }),
							...(filter === null ? {} : { now, filter }),
						}),
					);
					if (members.stale) {
						return yield* new RyotClientError({ reason: "collection-stale" });
					}
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
			sortChoices={sortChoices}
			filterFields={filterFields}
			viewContext={{ collectionId }}
			layouts={["grid", "list", "table"]}
			defaultSortLabel="Collection order"
			errorTitle="Collection unavailable"
			emptyMessage="This collection is empty."
			name={() => header?.name ?? "Collection"}
			errorMessage="The collection could not be loaded."
			tableColumns={collectionMemberTableColumns(membershipPropertiesSchema)}
			headerActions={[
				{ run: onReorder, label: "Reorder", icon: "arrow-up-down" },
				{ icon: "pencil", run: editCollection, label: "Edit collection" },
			]}
			renderItemActions={(item) => (
				<IconButton
					size="sm"
					onClick={() => memberDetails(item.entityId)}
					label={`Collection details for ${item.name ?? "item"}`}
				>
					<AppIcon size={16} name="more-horizontal" />
				</IconButton>
			)}
			// oxlint-disable-next-line react/no-unstable-nested-components -- The slot needs this collection ID.
			count={({ filter, onTotal, searchText: search }) => (
				<CollectionCount
					fields={fields}
					onTotal={onTotal}
					searchText={search}
					filter={filter ?? null}
					collectionId={collectionId}
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
						className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted"
					>
						<strong className="mr-1 font-semibold text-text">{total.toLocaleString()} total</strong>
						{groups.items.map((group) => (
							<span
								className="rounded-pill bg-surface-2 px-2 py-0.5"
								key={JSON.stringify([group.ownerPluginId, group.entitySchemaSlug])}
							>
								{group.count.toLocaleString()} {group.typeLabel}
							</span>
						))}
						{groups.pageInfo.hasMore && <span>More types not shown</span>}
					</section>
				</>
			)}
		/>
	);
};

const CollectionDetail = ({ collectionId }: { readonly collectionId: string }) => {
	const [reordering, setReordering] = useState(false);
	const header = useRyotQuery(headerQuery, collectionId);
	const groups = useRyotQuery(groupsQuery, collectionId);
	const total = useRyotQuery(totalQuery, collectionId);
	const schemas = useRyotQuery(
		browseQuery,
		(groups.data?.items ?? []).map(({ ownerPluginId, entitySchemaSlug }) => ({
			slug: entitySchemaSlug,
			pluginId: ownerPluginId,
		})),
	);
	if (
		header.data === undefined ||
		groups.data === undefined ||
		total.data === undefined ||
		schemas.data === undefined
	) {
		const failed = [header, groups, total, schemas].filter(({ isError }) => isError);
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
		schemas.data,
	]);
	const identityKey = JSON.stringify([collectionId, schemaKey]);
	if (reordering) {
		return (
			<CollectionOrder
				collectionId={collectionId}
				onClose={() => setReordering(false)}
				name={header.data?.name ?? "Collection"}
			/>
		);
	}
	return (
		<CollectionBrowser
			key={identityKey}
			total={total.data}
			header={header.data}
			groups={groups.data}
			schemas={schemas.data}
			identityKey={identityKey}
			collectionId={collectionId}
			onReorder={() => setReordering(true)}
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
