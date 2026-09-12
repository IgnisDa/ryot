import { Schema } from "@ryot-app/client-sdk/effect";
import { PluginLink, type EntityReference } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import {
	EntityArtWell,
	SyncPip,
	fieldSyncState,
	isTitleProvisional,
} from "@ryot-app/client-ui-sdk/sync";
import {
	collectionMembersCountsRecipe,
	type CollectionMembersCountsResult,
} from "@ryot-app/ryotql-recipes/collections";
import { useState } from "react";

import type { BrowserLayout } from "./entity-browser-controller";

const CollectionIds = Schema.Array(Schema.String);
const decodeCollectionIds = Schema.decodeUnknownSync(Schema.fromJsonString(CollectionIds));

const countLabel = (count: number) => `${count.toLocaleString()} item${count === 1 ? "" : "s"}`;

const countText = (count: number | undefined, hasError: boolean) => {
	if (count !== undefined) {
		return countLabel(count);
	}
	return hasError ? "Count unavailable" : "Counting items…";
};

const CollectionCard = ({
	count,
	layout,
	reference,
	countError,
}: {
	readonly countError: boolean;
	readonly count: number | undefined;
	readonly reference: EntityReference;
	readonly layout: Exclude<BrowserLayout, "table">;
}) => {
	const title = reference.name ?? "collection";
	const schemaLabel = reference.entitySchemaSlug.split("-").join(" ");
	return (
		<article
			data-layout={layout}
			data-entity-id={reference.entityId}
			className={
				layout === "grid" ? "grid min-w-0 content-start gap-2" : "flex min-w-0 items-center gap-3.5"
			}
		>
			<PluginLink
				aria-label={`Open ${title}`}
				to={{ kind: "entity", entityId: reference.entityId }}
				className={layout === "grid" ? "block min-w-0" : "block shrink-0"}
			>
				<EntityArtWell
					url={undefined}
					monogram={title}
					state={fieldSyncState(null, reference)}
					className={layout === "grid" ? "aspect-3/4 w-full rounded-lg" : "h-16 w-11 rounded-sm"}
				/>
			</PluginLink>
			<div className="grid min-w-0 flex-1 gap-1">
				<span className="truncate text-[11px] font-semibold tracking-wide text-text-subtle uppercase">
					{schemaLabel}
				</span>
				<span className="flex min-w-0 items-baseline gap-1.5">
					<PluginLink className="min-w-0" to={{ kind: "entity", entityId: reference.entityId }}>
						<span className="line-clamp-2 min-w-0 text-[15px] font-semibold text-text">
							{title}
						</span>
					</PluginLink>
					{isTitleProvisional(reference) && <SyncPip reason="translating" />}
				</span>
				<span className="text-xs text-text-muted">{countText(count, countError)}</span>
			</div>
		</article>
	);
};

export const CollectionCardResults = ({
	layout,
	references,
}: {
	readonly references: readonly EntityReference[];
	readonly layout: Exclude<BrowserLayout, "table">;
}) => {
	const collectionIds = JSON.stringify([...new Set(references.map(({ entityId }) => entityId))]);
	const [query] = useState(() =>
		createRyotQuery<string, CollectionMembersCountsResult>(({ input, client }) =>
			client.data.query(
				collectionMembersCountsRecipe({ collectionIds: decodeCollectionIds(input) }),
			),
		),
	);
	const result = useRyotQuery(query, collectionIds);
	return (
		<div className="@container">
			{result.isError && (
				<button type="button" onClick={result.refetch} className="mb-3 text-sm text-accent-text">
					Retry item counts
				</button>
			)}
			<div
				aria-busy={result.isPending || result.isFetching}
				className={
					layout === "grid"
						? "grid grid-cols-2 gap-x-3 gap-y-5 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5 @6xl:grid-cols-6"
						: "grid gap-3"
				}
			>
				{references.map((reference) => (
					<CollectionCard
						layout={layout}
						reference={reference}
						key={reference.entityId}
						countError={result.isError}
						count={result.data === undefined ? undefined : (result.data[reference.entityId] ?? 0)}
					/>
				))}
			</div>
		</div>
	);
};
