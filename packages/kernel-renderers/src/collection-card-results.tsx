import { Option, Schema } from "@ryot-app/client-sdk/effect";
import { PluginLink, type EntityReference } from "@ryot-app/client-sdk/plugin";
import {
	EntityArtWell,
	SyncPip,
	fieldSyncState,
	isTitleProvisional,
} from "@ryot-app/client-ui-sdk/sync";
import type { EntityBrowserResultItem } from "@ryot-app/ryotql-recipes/saved-views";

import type { BrowserLayout } from "./entity-browser-controller";

const CollectionPresentation = Schema.Struct({ presentationMemberCount: Schema.Finite });

const countLabel = (count: number) => `${count.toLocaleString()} item${count === 1 ? "" : "s"}`;

const countText = (count: number | undefined) => {
	if (count !== undefined) {
		return countLabel(count);
	}
	return "Count unavailable";
};

const CollectionCard = ({
	count,
	layout,
	reference,
}: {
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
				<span className="text-xs text-text-muted">{countText(count)}</span>
			</div>
		</article>
	);
};

export const CollectionCardResults = ({
	items,
	layout,
	references,
}: {
	readonly items: readonly EntityBrowserResultItem[];
	readonly references: readonly EntityReference[];
	readonly layout: Exclude<BrowserLayout, "table">;
}) => {
	const counts = new Map(
		items.map(({ entityId, presentation }) => [
			entityId,
			Option.map(
				Schema.decodeUnknownOption(CollectionPresentation)(presentation),
				({ presentationMemberCount }) => presentationMemberCount,
			).pipe(Option.getOrUndefined),
		]),
	);
	return (
		<div className="@container">
			<div
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
						count={counts.get(reference.entityId)}
					/>
				))}
			</div>
		</div>
	);
};
