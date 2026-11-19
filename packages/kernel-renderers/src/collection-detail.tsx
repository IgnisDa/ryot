import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	useDisplayText,
	useEntitlement,
	useHostScreen,
	useRyot,
	useRyotQuery,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { entitlementActionLabel, IconButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
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
	collectionMemberTypeValue,
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

/** Renders each member type's served name, adding the defining package where two names collide. */
const useMemberTypeLabels = (groups: CollectionMembersAggregateResult) => {
	const t = useT();
	const displayText = useDisplayText();
	const rendered = groups.items.map((group) => ({
		group,
		text: displayText(group.typeLabel),
		value: collectionMemberTypeValue(group),
	}));
	const counts = new Map<string, number>();
	for (const { text } of rendered) {
		counts.set(text, (counts.get(text) ?? 0) + 1);
	}
	return new Map(
		rendered.map(({ text, value, group }) => [
			value,
			(counts.get(text) ?? 0) > 1 && group.ownerPackageId !== null
				? t(
						kernelMessage("renderer.collection-detail.member-type", {
							type: text,
							plugin: group.ownerPackageId,
						}),
					)
				: text,
		]),
	);
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
	const t = useT();
	const openScreen = useHostScreen();
	const reorder = useEntitlement("pro");
	const pluginPages = useRyotQuery(pluginPagesQuery, [
		...new Set(groups.items.flatMap(({ ownerPluginId }) => ownerPluginId ?? [])),
	]);
	const pageActions = collectionPageLinks(collectionId, groups, pluginPages.data ?? []).map(
		(link) => ({
			icon: link.icon,
			label: t(link.label),
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
	const typeLabels = useMemberTypeLabels(groups);
	const filterFields = queryFilterFields(controls.data?.filter ?? []).map((control) => {
		if (control.key === "collections") {
			return Object.assign({}, control, {
				label: t(kernelMessage("renderer.collection-detail.also-in-collection")),
			});
		}
		return control.key === "member-type" && "choices" in control
			? Object.assign({}, control, {
					choices: control.choices.map((choice) =>
						Object.assign({}, choice, { label: typeLabels.get(choice.value) ?? choice.label }),
					),
				})
			: control;
	});
	const typeColumn = collectionMemberTableColumns(membershipPropertiesSchema)[1]?.field;
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
			<PluginScreenFrame
				title={header?.name ?? kernelMessage("definition.entity-schema.collection")}
			>
				{controls.error ? (
					<BrowserInlineError
						onRetry={controls.refetch}
						title={t(kernelMessage("renderer.collection-detail.unavailable"))}
						message={t(kernelMessage("renderer.collection-detail.controls-failed"))}
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
			layouts={["grid", "list", "table"]}
			emptyMessage={t(kernelMessage("renderer.collection-detail.empty"))}
			defaultSortLabel={t(kernelMessage("renderer.collection-order.label"))}
			errorTitle={t(kernelMessage("renderer.collection-detail.unavailable"))}
			errorMessage={t(kernelMessage("renderer.collection-detail.load-failed"))}
			name={header?.name ?? t(kernelMessage("definition.entity-schema.collection"))}
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
					label: t(kernelMessage("renderer.collection-detail.reviews")),
					onSelect: () => openScreen(ryot.screens.manageCollectionReviews({ collectionId })),
				},
				{
					key: "reorder",
					onSelect: onReorder,
					icon: "arrow-up-down",
					disabled: !reorder.granted,
					label: entitlementActionLabel(
						t,
						t(kernelMessage("renderer.collection-detail.reorder")),
						"pro",
						reorder.granted,
					),
				},
				{
					key: "share",
					icon: "share",
					onSelect: share,
					label: t(kernelMessage("common.action.share")),
				},
				{
					key: "edit",
					icon: "pencil",
					onSelect: editCollection,
					label: t(kernelMessage("renderer.collection-detail.edit")),
				},
			]}
			renderResults={(results) => (
				<EntityBrowserResults
					layout={results.layout}
					settled={results.settled}
					selection={results.selection}
					viewContext={{ collectionId }}
					columns={collectionMemberTableColumns(membershipPropertiesSchema)}
					renderItemActions={(item) => (
						<IconButton
							size="sm"
							onClick={() => memberDetails(item.entityId)}
							label={t(
								kernelMessage("renderer.collection-detail.member-details", {
									name: item.name ?? "",
								}),
							)}
						>
							<AppIcon size={16} name="more-horizontal" />
						</IconButton>
					)}
					items={results.items.map((item) =>
						Object.assign({}, item, {
							cells: item.cells.map((cell) =>
								cell.key === typeColumn
									? Object.assign({}, cell, {
											value: {
												displayKind: "text" as const,
												value: typeLabels.get(collectionMemberTypeValue(item)) ?? cell.value.value,
											},
										})
									: cell,
							),
						}),
					)}
				/>
			)}
			renderSummary={() => (
				<>
					{header?.description ? (
						<p className="text-sm text-text-muted">{header.description}</p>
					) : null}
					<section
						aria-label={t(kernelMessage("renderer.collection-detail.summary"))}
						className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted"
					>
						<strong className="mr-1 font-semibold text-text">
							{t(kernelMessage("renderer.collection-detail.total", { count: total }))}
						</strong>
						{groups.items.map((group) => (
							<span
								className="rounded-pill bg-surface-2 px-2 py-0.5"
								key={JSON.stringify([group.ownerPluginId, group.entitySchemaSlug])}
							>
								{t(
									kernelMessage("renderer.collection-detail.type-count", {
										count: group.count,
										type: typeLabels.get(collectionMemberTypeValue(group)) ?? group.typeLabel,
									}),
								)}
							</span>
						))}
						{groups.pageInfo.hasMore && (
							<span>{t(kernelMessage("renderer.collection-detail.more-types"))}</span>
						)}
					</section>
				</>
			)}
		/>
	);
};

const CollectionDetail = ({ collectionId }: { readonly collectionId: string }) => {
	const t = useT();
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
			<PluginScreenFrame title={kernelMessage("definition.entity-schema.collection")}>
				{failed.length === 0 ? null : (
					<BrowserInlineError
						onRetry={() => failed.forEach(({ refetch }) => refetch())}
						title={t(kernelMessage("renderer.collection-detail.unavailable"))}
						message={t(kernelMessage("renderer.collection-detail.load-failed"))}
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
				name={header.data?.name ?? t(kernelMessage("definition.entity-schema.collection"))}
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
	const t = useT();
	const location = usePluginLocation();
	return location.kind !== "entity" ? (
		<PluginScreenFrame title={kernelMessage("definition.entity-schema.collection")}>
			<StatusMessage tone="error">
				{t(kernelMessage("renderer.collection-detail.invalid"))}
			</StatusMessage>
		</PluginScreenFrame>
	) : (
		<CollectionDetail collectionId={location.entityId} />
	);
}
