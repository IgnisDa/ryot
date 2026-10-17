import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePluginLocation } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	usePageRefreshRequest,
	useRyot,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, IconButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
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
import { useHostScreen } from "./host-screen";

const QueryInput = Schema.Tuple([
	Schema.String,
	Schema.Union([Schema.Literal(""), CollectionMemberSort]),
	Schema.NullOr(Schema.String),
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
		createRyotQuery<string, number>(({ client, input: search }) =>
			client.data.query(
				collectionMembersCountRecipe({
					collectionId,
					...(search === "" ? {} : { searchText: search }),
				}),
			),
		),
	);
	const result = useRyotQuery(query, searchText);
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

const CollectionDetail = ({ collectionId }: { readonly collectionId: string }) => {
	const ryot = useRyot();
	const refresh = usePageRefreshRequest();
	const openScreen = useHostScreen();
	const editCollection = () =>
		openScreen(ryot.screens.editCollection({ collectionId }), (outcome) => {
			if (outcome.kind === "deleted") {
				ryot.navigation.replace({
					kind: "saved-view",
					reference: { kind: "kernel", slug: "collections" },
				});
			} else if (outcome.kind === "saved") {
				refresh();
			}
		});
	const memberDetails = (entityId: string) =>
		openScreen(ryot.screens.addToCollection({ entityId, collectionId }), (outcome) => {
			if (outcome.kind !== "cancelled") {
				refresh();
			}
		});
	const [query] = useState(() =>
		createRyotQuery<string, BrowserQueryPage<CollectionMeta>>(
			({ input, client }) =>
				Effect.gen(function* () {
					const [searchText, sortChoice, after] = decodeQueryInput(input);
					const header = yield* client.data.query(collectionHeaderRecipe({ collectionId }));
					const [groups, total, members] = yield* Effect.all(
						[
							client.data.query(collectionMembersAggregateRecipe({ collectionId })),
							client.data.query(collectionMembersCountRecipe({ collectionId })),
							client.data.query(
								collectionMembersRecipe({
									collectionId,
									membershipPropertiesSchema: header?.membershipPropertiesSchema ?? null,
									...(searchText === "" ? {} : { searchText }),
									...(sortChoice === "" ? {} : { sort: sortChoice }),
									...(after === null ? {} : { after }),
								}),
							),
						],
						{ concurrency: "unbounded" },
					);
					const tableColumns = collectionMemberTableColumns(
						header?.membershipPropertiesSchema ?? null,
					);
					return { result: members, meta: { total, groups, header, tableColumns } };
				}),
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
			headerAction={{ icon: "pencil", run: editCollection, label: "Edit collection" }}
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
			renderItemActions={(item) => (
				<IconButton
					size="sm"
					onClick={() => memberDetails(item.entityId)}
					label={`Collection details for ${item.name ?? "item"}`}
				>
					<AppIcon size={16} name="ellipsis" />
				</IconButton>
			)}
			renderSummary={(meta) => {
				return (
					<>
						{meta.header?.description ? (
							<p className="text-sm text-text-muted">{meta.header.description}</p>
						) : null}
						<section
							aria-label="Collection summary"
							className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted"
						>
							<strong className="font-semibold text-text">
								{meta.total.toLocaleString()} total
							</strong>
							{meta.groups.items.map((group) => (
								<span key={JSON.stringify([group.ownerPluginId, group.entitySchemaSlug])}>
									{group.count.toLocaleString()} {group.typeLabel}
								</span>
							))}
							{meta.groups.pageInfo?.hasMore && <span>More types not shown</span>}
						</section>
					</>
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
