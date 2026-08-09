import type { SavedViewCardResultItem } from "@ryot-app/ryotql-recipes/saved-views";
import { Link } from "@tanstack/react-router";

import { ManagedImage } from "#/modules/assets/managed-image";
import { formatSavedViewValue } from "#/modules/saved-views/display-value";

export function SavedViewList(props: {
	readonly items: readonly SavedViewCardResultItem[];
	readonly managedUrls: ReadonlyMap<string, string>;
}) {
	return (
		<div className="border-t border-border">
			{props.items.map((item) => (
				<Link
					to="/e/$entityId"
					key={item.entityId}
					aria-label={`Open ${item.title}`}
					params={{ entityId: item.entityId }}
					className="relative flex min-h-28 items-center gap-3 overflow-hidden border-b border-border px-1 py-2 outline-none focus-visible:ring-2 focus-visible:ring-focus md:min-h-18 md:gap-3.5"
				>
					{item.image !== undefined && (
						<ManagedImage
							asset={item.image}
							urls={props.managedUrls}
							className="h-24 w-16 shrink-0 rounded-md bg-surface-2 object-cover md:h-16 md:w-11 md:rounded-sm"
						/>
					)}
					<div className="grid min-w-0 flex-1 gap-0.5">
						{item.overline && (
							<span className="truncate text-[11px] font-semibold tracking-wide text-text-subtle uppercase">
								{formatSavedViewValue(item.overline)}
							</span>
						)}
						<span className="line-clamp-2 text-[17px] font-semibold text-text md:text-[15px] md:font-normal">
							{item.title}
						</span>
						{item.primaryMetadata && (
							<span className="truncate text-[13px] text-text-muted">
								{formatSavedViewValue(item.primaryMetadata)}
							</span>
						)}
						{item.secondaryMetadata && (
							<span className="truncate text-xs text-text-subtle">
								{formatSavedViewValue(item.secondaryMetadata)}
							</span>
						)}
					</div>
					{item.callout && (
						<span className="max-w-24 shrink-0 truncate text-sm font-semibold text-accent-text">
							{formatSavedViewValue(item.callout)}
						</span>
					)}
				</Link>
			))}
		</div>
	);
}
