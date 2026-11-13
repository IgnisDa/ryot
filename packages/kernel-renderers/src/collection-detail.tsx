import {
	addToCollectionAction,
	BrowserInlineError,
	type BrowserQueryInput,
	EntityBrowserController,
	EntityBrowserResults,
	removeFromCollectionAction,
} from "@ryot-app/plugin-client-sdk/browser";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePluginLocation } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	useHostScreen,
	useRyot,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { IconButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	type BrowseSchema,
	type EntitySchemaBrowseResult,
	loadEntitySchemaBrowse,
} from "@ryot-app/ryotql-recipes/browse";
import {
	collectionArguments,
	collectionHeaderRecipe,
	type CollectionHeaderResult,
	collectionMemberIdsRecipe,
	collectionMembersAggregateRecipe,
	type CollectionMembersAggregateResult,
	collectionMembersCountRecipe,
	collectionMembersRecipe,
	type CollectionMembersResult,
	collectionMemberTableColumns,
	collectionPageLinks,
	collectionPluginPagesRecipe,
	type CollectionPluginPagesResult,
} from "@ryot-app/ryotql-recipes/collections";
import { queryFilterFields } from "@ryot-app/ryotql-recipes/filters";
import { useState } from "react";

import { CollectionOrder } from "./collection-order";

const headerQuery = createRyotQuery<string, CollectionHeaderResult>(({ input, client }) =>
	client.data.query(collectionHeaderRecipe, { collectionId: input }),
);
const groupsQuery = createRyotQuery<string, CollectionMembersAggregateResult>(({ input, client }) =>
	client.data.query(collectionMembersAggregateRecipe, collectionArguments(input)),
);
const browseQuery = createRyotQuery<
	readonly Pick<BrowseSchema, "slug" | "pluginId">[],
	EntitySchemaBrowseResult
>(({ input, client }) => loadEntitySchemaBrowse(input, (recipe) => client.data.query(recipe, {})));
const totalQuery = createRyotQuery<string, number>(({ input, client }) =>
	client.data.query(collectionMembersCountRecipe(), collectionArguments(input)),
);
const pluginPagesQuery = createRyotQuery<readonly string[], CollectionPluginPagesResult>(
	({ input, client }) => {
		const [first, ...rest] = input;
		return first === undefined
			? Effect.succeed([])
			: client.data.query(collectionPluginPagesRecipe, { pluginIds: [first, ...rest] });
	},
);

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
	const pluginPages = useRyotQuery(pluginPagesQuery, [
		...new Set(groups.items.flatMap(({ ownerPluginId }) => ownerPluginId ?? [])),
	]);
	const pageActions = collectionPageLinks(collectionId, groups, pluginPages.data ?? []).map(
		(link) => ({
			icon: link.icon,
			label: link.label,
			key: `${link.packageId}${link.path}`,
			onSelect: () =>
				ryot.navigation.push({
					search: {},
					path: link.path,
					kind: "plugin-route",
					packageId: link.packageId,
				}),
		}),
	);
	const editCollection = () =>
		openScreen(ryot.screens.editCollection({ collectionId }), (outcome) => {
			if (outcome.kind === "deleted") {
				ryot.navigation.replace({
					kind: "saved-view",
					reference: { kind: "kernel", slug: "collections" },
				});
			}
		});
	const share = () =>
		openScreen(ryot.screens.sharePublication({ source: { collectionId, kind: "collection" } }));
	const memberDetails = (entityId: string) =>
		openScreen(ryot.screens.addToCollection({ entityId, collectionId }));
	const membershipPropertiesSchema = header?.membershipPropertiesSchema ?? null;
	const fields = { groups, schemas, membershipPropertiesSchema };
	const [memberRecipe] = useState(() => collectionMembersRecipe({ fields }));
	const [controlQuery] = useState(() =>
		createRyotQuery(({ client }) =>
			client.data.describe(
				{ kind: "inline", query: "members", document: memberRecipe.document },
				collectionArguments(collectionId),
			),
		),
	);
	const controls = useRyotQuery(controlQuery);
	const sortChoices = controls.data?.sort ?? [];
	const filterFields = queryFilterFields(controls.data?.filter ?? []).map((control) =>
		control.key === "collections"
			? Object.assign({}, control, { label: "Also in collection" })
			: control,
	);
	const [query] = useState(() =>
		createRyotQuery<BrowserQueryInput, CollectionMembersResult>(
			({ client, input: { filter, cursor, searchText, sortChoice } }) =>
				client.data.query(
					memberRecipe,
					{ ...collectionArguments(collectionId), searchText },
					{
						...(filter === null ? {} : { filter }),
						...(sortChoice === "" ? {} : { sort: sortChoice }),
						pages: { members: cursor === null ? {} : { after: cursor } },
					},
				),
			{ cancelOnUnmount: true },
		),
	);
	if (controls.data === undefined) {
		return (
			<PluginScreenFrame title={header?.name ?? "Collection"}>
				{controls.error ? (
					<BrowserInlineError
						onRetry={controls.refetch}
						title="Collection unavailable"
						message="The collection controls could not be loaded."
					/>
				) : null}
			</PluginScreenFrame>
		);
	}
	return (
		<EntityBrowserController
			query={query}
			icon="library"
			knownTotal={total}
			defaultLayout="grid"
			identityKey={identityKey}
			sortChoices={sortChoices}
			filterFields={filterFields}
			name={header?.name ?? "Collection"}
			layouts={["grid", "list", "table"]}
			defaultSortLabel="Collection order"
			errorTitle="Collection unavailable"
			emptyMessage="This collection is empty."
			errorMessage="The collection could not be loaded."
			count={(client, { filter, searchText }) =>
				client.data.query(
					collectionMembersCountRecipe({ fields }),
					{ ...collectionArguments(collectionId), searchText },
					filter === null ? {} : { filter },
				)
			}
			selection={{
				actions: [addToCollectionAction(ryot), removeFromCollectionAction(ryot, collectionId)],
				readIds: (client, { after, filter, searchText }) =>
					client.data.query(
						collectionMemberIdsRecipe({ fields }),
						{ ...collectionArguments(collectionId), searchText },
						{
							...(filter === null ? {} : { filter }),
							pages: { memberIds: after === undefined ? {} : { after } },
						},
					),
			}}
			menuActions={[
				...pageActions,
				{
					icon: "star",
					key: "reviews",
					label: "Reviews",
					onSelect: () => openScreen(ryot.screens.manageCollectionReviews({ collectionId })),
				},
				{ key: "reorder", label: "Reorder", onSelect: onReorder, icon: "arrow-up-down" },
				{ key: "share", icon: "share", label: "Share", onSelect: share },
				{ key: "edit", icon: "pencil", onSelect: editCollection, label: "Edit collection" },
			]}
			renderResults={(results) => (
				<EntityBrowserResults
					items={results.items}
					layout={results.layout}
					settled={results.settled}
					selection={results.selection}
					viewContext={{ collectionId }}
					columns={collectionMemberTableColumns(membershipPropertiesSchema)}
					renderItemActions={(item) => (
						<IconButton
							size="sm"
							onClick={() => memberDetails(item.entityId)}
							label={`Collection details for ${item.name ?? "item"}`}
						>
							<AppIcon size={16} name="more-horizontal" />
						</IconButton>
					)}
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
