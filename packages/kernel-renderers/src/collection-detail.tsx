import { Schema } from "@ryot-app/client-sdk/effect";
import { usePluginLocation } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import {
	collectionHeaderRecipe,
	collectionMemberTableColumns,
	CollectionMemberSort,
	collectionMembersAggregateRecipe,
	collectionMembersCountRecipe,
	collectionMembersRecipe,
	type CollectionHeaderResult,
	type CollectionMembersAggregateResult,
} from "@ryot-app/ryotql-recipes/collections";
import { useEffect, useEffectEvent, useState } from "react";

import type { BrowserColumns } from "./browser-table";
import { EntityBrowserController, type BrowserQueryPage } from "./entity-browser-controller";

const QueryInput = Schema.Tuple([
	Schema.String,
	Schema.Union([Schema.Literal(""), CollectionMemberSort]),
	Schema.NullOr(Schema.String),
	Schema.Number,
]);
const decodeQueryInput = Schema.decodeUnknownSync(Schema.fromJsonString(QueryInput));

type CollectionMeta = {
	readonly header: CollectionHeaderResult;
	readonly groups: CollectionMembersAggregateResult;
	readonly tableColumns: BrowserColumns;
	readonly total: number;
};

const CollectionCount = ({
	onTotal,
	searchText,
	collectionId,
}: {
	readonly collectionId: string;
	readonly searchText: string;
	readonly onTotal: (total: number | undefined) => void;
}) => {
	const [query] = useState(() =>
		createRyotQuery<string, number>(({ client, signal, input: search }) =>
			client.data.query(
				collectionMembersCountRecipe({
					collectionId,
					...(search === "" ? {} : { searchText: search }),
				}),
				{ signal },
			),
		),
	);
	const result = useRyotQuery(query, searchText);
	const report = useEffectEvent((total: number | undefined) => onTotal(total));
	useEffect(() => report(result.data), [result.data]);
	if (result.isPending) {
		return (
			<Button disabled variant="text" className="text-sm text-accent-text">
				Counting...
			</Button>
		);
	}
	if (result.isError) {
		return (
			<Button variant="text" onClick={result.refetch} className="text-sm text-accent-text">
				Retry count
			</Button>
		);
	}
	return null;
};

const CollectionDetail = ({ collectionId }: { readonly collectionId: string }) => {
	const [query] = useState(() =>
		createRyotQuery<string, BrowserQueryPage<CollectionMeta>>(
			async ({ input, client, signal }) => {
				const [searchText, sortChoice, after] = decodeQueryInput(input);
				const header = await client.data.query(collectionHeaderRecipe({ collectionId }), {
					signal,
				});
				const [groups, total, members] = await Promise.all([
					client.data.query(collectionMembersAggregateRecipe({ collectionId }), { signal }),
					client.data.query(collectionMembersCountRecipe({ collectionId }), { signal }),
					client.data.query(
						collectionMembersRecipe({
							collectionId,
							membershipPropertiesSchema: header?.membershipPropertiesSchema ?? null,
							...(searchText === "" ? {} : { searchText }),
							...(sortChoice === "" ? {} : { sort: sortChoice }),
							...(after === null ? {} : { after }),
						}),
						{ signal },
					),
				]);
				const tableColumns = collectionMemberTableColumns(
					header?.membershipPropertiesSchema ?? null,
				);
				return { input, result: members, meta: { total, groups, header, tableColumns } };
			},
			{ cancelOnUnmount: true },
		),
	);
	return (
		<EntityBrowserController
			query={query}
			icon="library"
			defaultLayout="grid"
			identityKey={collectionId}
			viewContext={{ collectionId }}
			layouts={["grid", "list", "table"]}
			defaultSortLabel="Collection order"
			errorTitle="Collection unavailable"
			emptyMessage="This collection is empty."
			tableColumns={(meta) => meta?.tableColumns ?? []}
			errorMessage="The collection could not be loaded."
			name={(meta) => meta?.header?.name ?? "Collection"}
			// oxlint-disable-next-line react/no-unstable-nested-components -- The slot needs this collection ID.
			count={(search, onTotal) => (
				<CollectionCount
					onTotal={onTotal}
					searchText={search}
					collectionId={collectionId}
					key={JSON.stringify([collectionId, search])}
				/>
			)}
			sortChoices={[
				{ label: "Name A-Z", value: "name-asc" },
				{ label: "Name Z-A", value: "name-desc" },
				{ label: "Recently added", value: "recently-added" },
				{ label: "Oldest added", value: "oldest-added" },
			]}
			renderSummary={(meta) => {
				return (
					<section
						aria-label="Collection summary"
						className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted"
					>
						<strong className="font-semibold text-text">{meta.total.toLocaleString()} total</strong>
						{meta.groups.items.map((group) => (
							<span key={JSON.stringify([group.ownerPluginId, group.entitySchemaSlug])}>
								{group.count.toLocaleString()} {group.typeLabel}
							</span>
						))}
						{meta.groups.pageInfo?.hasMore && <span>More types not shown</span>}
					</section>
				);
			}}
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
