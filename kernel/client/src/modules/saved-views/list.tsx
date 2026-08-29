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

export function SavedViewList(props: {
	readonly settled: EntitySettle;
	readonly mapping: SavedViewCardMapping;
	readonly items: readonly SavedViewCardResultItem[];
	readonly managedUrls: ReadonlyMap<string, string>;
}) {
	return (
		<div className="border-t border-border">
			{props.items.map((item) => {
				const slots = cardSyncSlots(item, props.mapping);
				return (
					<SettleHighlight
						key={item.entityId}
						className="border-b border-border"
						reason={props.settled.get(item.entityId)}
					>
						<Link
							to="/e/$entityId"
							aria-label={`Open ${item.title}`}
							params={{ entityId: item.entityId }}
							className="relative flex min-h-28 items-center gap-3 overflow-hidden px-1 py-2 outline-none focus-visible:ring-2 focus-visible:ring-focus md:min-h-18 md:gap-3.5"
						>
							{item.image !== undefined && (
								<ManagedImage
									asset={item.image}
									state={slots.image}
									monogram={item.title}
									urls={props.managedUrls}
									className="h-24 w-16 shrink-0 rounded-md md:h-16 md:w-11 md:rounded-sm"
								/>
							)}
							<div className="grid min-w-0 flex-1 gap-0.5">
								<SavedViewRow
									value={item.overline}
									state={slots.overline}
									className="truncate text-[11px] font-semibold tracking-wide text-text-subtle uppercase"
								/>
								<span className="flex min-w-0 items-baseline gap-1.5">
									<span className="line-clamp-2 min-w-0 text-[17px] font-semibold text-text md:text-[15px] md:font-normal">
										{item.title}
									</span>
									{isTitleProvisional(item.sync) && <SyncPip reason="translating" />}
								</span>
								<SavedViewRow
									value={item.primaryMetadata}
									state={slots.primaryMetadata}
									className="truncate text-[13px] text-text-muted"
								/>
								<SavedViewRow
									value={item.secondaryMetadata}
									state={slots.secondaryMetadata}
									className="truncate text-xs text-text-subtle"
								/>
							</div>
							<SavedViewRow
								value={item.callout}
								state={slots.callout}
								className="max-w-24 shrink-0 truncate text-sm font-semibold text-accent-text"
							/>
						</Link>
					</SettleHighlight>
				);
			})}
		</div>
	);
}

function SavedViewRow(props: {
	readonly className: string;
	readonly state: FieldSyncState;
	readonly value: SavedViewDisplayValue | undefined;
}) {
	if (props.value === undefined) {
		return props.state === "pending" ? (
			<span aria-hidden="true" className={`${props.className} invisible`}>
				&nbsp;
			</span>
		) : null;
	}
	return <span className={props.className}>{formatSavedViewValue(props.value)}</span>;
}
