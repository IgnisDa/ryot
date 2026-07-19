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
		<div className="-mx-1.5 flex flex-wrap md:-mx-2.5">
			{props.items.map((item) => (
				<Link
					to="/e/$entityId"
					key={item.entityId}
					aria-label={`Open ${item.title}`}
					params={{ entityId: item.entityId }}
					className="grid w-1/2 content-start gap-2 rounded-lg px-1.5 pb-5 outline-none focus-visible:ring-2 focus-visible:ring-focus sm:w-1/3 md:w-1/4 md:px-2.5 lg:w-1/5 xl:w-1/6"
				>
					{item.image !== undefined && (
						<ManagedImage
							asset={item.image}
							urls={props.managedUrls}
							className="aspect-3/4 w-full rounded-lg bg-surface-2 object-cover"
						/>
					)}
					<div className="grid min-w-0 gap-1">
						{item.overline && <SavedViewValue tone="overline" value={item.overline} />}
						<span className="line-clamp-2 text-base font-semibold text-text md:text-sm md:font-normal">
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
