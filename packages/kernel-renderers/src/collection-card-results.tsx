import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { browserResultEntries, itemCountMessage } from "@ryot-app/plugin-client-sdk/browser";
import {
	type EntityBrowserLayout,
	type EntityReference,
	PluginLink,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useDisplayText, useT } from "@ryot-app/plugin-client-sdk/react";
import {
	Eyebrow,
	type ItemSelection,
	resultsLayoutClasses,
	SelectableItem,
} from "@ryot-app/plugin-ui-sdk";
import {
	EntityArtWell,
	fieldSyncState,
	isTitleProvisional,
	SyncPip,
} from "@ryot-app/plugin-ui-sdk/sync";
import type { EntityBrowserResultItem } from "@ryot-app/ryotql-recipes/saved-views";

const countMessage = (count: number | undefined) =>
	count === undefined
		? kernelMessage("renderer.collections.count-unavailable")
		: itemCountMessage(count);

const CollectionCard = ({
	count,
	layout,
	reference,
}: {
	readonly count: number | undefined;
	readonly reference: EntityReference;
	readonly layout: Exclude<EntityBrowserLayout, "table">;
}) => {
	const t = useT();
	const title = reference.name ?? t(kernelMessage("renderer.collections.untitled"));
	return (
		<article
			data-layout={layout}
			data-entity-id={reference.entityId}
			className={
				layout === "grid" ? "grid min-w-0 content-start gap-2" : "flex min-w-0 items-center gap-3.5"
			}
		>
			<PluginLink
				to={{ kind: "entity", entityId: reference.entityId }}
				className={layout === "grid" ? "block min-w-0" : "block shrink-0"}
				aria-label={t(kernelMessage("sdk.entity-results.open-item", { name: title }))}
			>
				<EntityArtWell
					url={undefined}
					monogram={title}
					state={fieldSyncState(null, reference)}
					className={layout === "grid" ? "aspect-3/4 w-full rounded-lg" : "h-16 w-11 rounded-sm"}
				/>
			</PluginLink>
			<div className="grid min-w-0 flex-1 gap-1">
				<Eyebrow>{t(kernelMessage("definition.entity-schema.collection"))}</Eyebrow>
				<span className="flex min-w-0 items-baseline gap-1.5">
					<PluginLink className="min-w-0" to={{ kind: "entity", entityId: reference.entityId }}>
						<span className="line-clamp-2 min-w-0 text-[15px] font-semibold text-text">
							{title}
						</span>
					</PluginLink>
					{isTitleProvisional(reference) && <SyncPip reason="translating" />}
				</span>
				<span className="text-xs text-text-muted">{t(countMessage(count))}</span>
			</div>
		</article>
	);
};

export const CollectionCardResults = ({
	items,
	layout,
	selection,
}: {
	readonly selection: undefined | ItemSelection;
	readonly items: readonly EntityBrowserResultItem[];
	readonly layout: Exclude<EntityBrowserLayout, "table">;
}) => {
	const displayText = useDisplayText();
	const { references } = browserResultEntries(items);
	const counts = new Map(
		items.map(({ cells, entityId }) => {
			const value = cells.find((cell) => cell.key === "memberCount")?.value.value;
			return [entityId, typeof value === "number" ? value : undefined];
		}),
	);
	return (
		<div className="@container">
			<div className={resultsLayoutClasses[layout]}>
				{references.map((reference) => (
					<SelectableItem
						selection={selection}
						id={reference.entityId}
						key={reference.entityId}
						label={displayText(reference.name)}
					>
						<CollectionCard
							layout={layout}
							reference={reference}
							count={counts.get(reference.entityId)}
						/>
					</SelectableItem>
				))}
			</div>
		</div>
	);
};
