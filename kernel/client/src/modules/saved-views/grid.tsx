import type { EntitySettle } from "@ryot-app/client-sdk";
import {
	isTitleProvisional,
	SettleHighlight,
	SyncPip,
	type FieldSyncState,
} from "@ryot-app/client-ui-sdk/sync";
import type {
	SavedViewCardMapping,
	SavedViewDisplayValue,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type { SavedViewCardResultItem } from "@ryot-app/ryotql-recipes/saved-views";
import { Link } from "@tanstack/react-router";

import { ManagedImage } from "#/modules/assets/managed-image";
import { formatSavedViewValue } from "#/modules/saved-views/display-value";
import { cardSyncSlots } from "#/modules/saved-views/sync-summary";

export function SavedViewGrid(props: {
	readonly settled: EntitySettle;
	readonly mapping: SavedViewCardMapping;
	readonly managedUrls: ReadonlyMap<string, string>;
	readonly items: readonly SavedViewCardResultItem[];
}) {
	return (
		<div className="-mx-1.5 flex flex-wrap md:-mx-2.5">
			{props.items.map((item) => {
				const slots = cardSyncSlots(item, props.mapping);
				return (
					<SettleHighlight
						key={item.entityId}
						reason={props.settled.get(item.entityId)}
						className="w-1/2 rounded-lg px-1.5 pb-5 sm:w-1/3 md:w-1/4 md:px-2.5 lg:w-1/5 xl:w-1/6"
					>
						<Link
							to="/e/$entityId"
							aria-label={`Open ${item.title}`}
							params={{ entityId: item.entityId }}
							className="grid content-start gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus"
						>
							{item.image !== undefined && (
								<ManagedImage
									asset={item.image}
									state={slots.image}
									monogram={item.title}
									urls={props.managedUrls}
									className="aspect-3/4 w-full rounded-lg"
								/>
							)}
							<div className="grid min-w-0 gap-1">
								<SavedViewSlot tone="overline" state={slots.overline} value={item.overline} />
								<span className="flex min-w-0 items-baseline gap-1.5">
									<span className="line-clamp-2 min-w-0 text-base font-semibold text-text md:text-sm md:font-normal">
										{item.title}
									</span>
									{isTitleProvisional(item.sync) && <SyncPip reason="translating" />}
								</span>
								<SavedViewSlot
									tone="primary"
									value={item.primaryMetadata}
									state={slots.primaryMetadata}
								/>
								<SavedViewSlot
									tone="secondary"
									value={item.secondaryMetadata}
									state={slots.secondaryMetadata}
								/>
								<SavedViewSlot tone="callout" state={slots.callout} value={item.callout} />
							</div>
						</Link>
					</SettleHighlight>
				);
			})}
		</div>
	);
}

const valueClasses = {
	primary: "text-xs text-text-muted",
	secondary: "text-xs text-text-subtle",
	callout: "text-xs font-semibold text-accent-text",
	overline: "text-[11px] font-semibold tracking-wide text-text-subtle uppercase",
} as const;

function SavedViewSlot(props: {
	readonly state: FieldSyncState;
	readonly tone: keyof typeof valueClasses;
	readonly value: SavedViewDisplayValue | undefined;
}) {
	if (props.value === undefined) {
		return props.state === "pending" ? (
			<span aria-hidden="true" className={`${valueClasses[props.tone]} invisible`}>
				&nbsp;
			</span>
		) : null;
	}
	return (
		<span className={`truncate ${valueClasses[props.tone]}`}>
			{formatSavedViewValue(props.value)}
		</span>
	);
}
