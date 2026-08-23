import type { SavedViewDisplayValue } from "@ryot-app/contract/modules/saved-views/schemas";
import type { SavedViewCardResultItem } from "@ryot-app/ryotql-recipes/saved-views";
import { Link } from "@tanstack/react-router";

import { ManagedImage } from "#/modules/assets/managed-image";
import { formatSavedViewValue } from "#/modules/saved-views/display-value";

export function SavedViewGrid(props: {
	readonly managedUrls: ReadonlyMap<string, string>;
	readonly items: readonly SavedViewCardResultItem[];
}) {
	return (
		<div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 md:gap-x-5 lg:grid-cols-5 xl:grid-cols-6">
			{props.items.map((item) => (
				<Link
					to="/e/$entityId"
					key={item.entityId}
					aria-label={`Open ${item.title}`}
					params={{ entityId: item.entityId }}
					className="group grid content-start gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
				>
					{item.image !== undefined && (
						<ManagedImage
							asset={item.image}
							urls={props.managedUrls}
							className="aspect-3/4 w-full rounded-lg object-cover"
						/>
					)}
					<div className="grid min-w-0 gap-1 px-0.5">
						{item.overline && <SavedViewValue tone="overline" value={item.overline} />}
						<span className="line-clamp-2 text-sm leading-snug font-semibold text-text">
							{item.title}
						</span>
						{item.primaryMetadata && <SavedViewValue tone="primary" value={item.primaryMetadata} />}
						{item.secondaryMetadata && (
							<SavedViewValue tone="secondary" value={item.secondaryMetadata} />
						)}
						{item.callout && <SavedViewValue tone="callout" value={item.callout} />}
					</div>
				</Link>
			))}
		</div>
	);
}

const valueClasses = {
	primary: "text-xs text-text-muted",
	secondary: "text-xs text-text-subtle",
	callout: "text-xs font-semibold text-accent-text",
	overline: "text-[11px] font-semibold tracking-wide text-text-subtle uppercase",
} as const;

function SavedViewValue(props: {
	readonly value: SavedViewDisplayValue;
	readonly tone: keyof typeof valueClasses;
}) {
	return (
		<span className={`truncate ${valueClasses[props.tone]}`}>
			{formatSavedViewValue(props.value)}
		</span>
	);
}
