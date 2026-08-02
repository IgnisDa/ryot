import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { getEntityHref } from "@/modules/navigation/navigation-data";

import type { SavedViewCardItem } from "./display-data";
import { SavedViewImageView } from "./saved-view-image";
import { SavedViewTintOverlay, useSavedViewTint } from "./saved-view-tint-view";
import { SavedViewValue } from "./saved-view-value";

function SavedViewListRow(props: {
	item: SavedViewCardItem;
	managedUrls: ReadonlyMap<string, string>;
}) {
	const { gradientStops, onImageError } = useSavedViewTint({
		image: props.item.image,
		managedUrls: props.managedUrls,
	});

	return (
		<Link asChild href={getEntityHref(props.item.entityId)}>
			<Pressable
				accessibilityRole="link"
				accessibilityLabel={`Open ${props.item.title}`}
				className="relative min-h-28 flex-row items-center gap-3 overflow-hidden border-b border-border py-2 focus-visible:outline-2 focus-visible:outline-accent md:min-h-18 md:gap-3.5 px-1"
			>
				<SavedViewTintOverlay gradientStops={gradientStops} />
				<SavedViewImageView
					onError={onImageError}
					image={props.item.image}
					managedUrls={props.managedUrls}
					className="h-24 w-16 rounded-md bg-surface-2 md:h-16 md:w-11 md:rounded-sm"
				/>
				<View className="min-w-0 flex-1 gap-0.5">
					{props.item.overline && (
						<SavedViewValue
							value={props.item.overline}
							className="font-ui-medium text-[11px] uppercase tracking-wide text-text-subtle"
						/>
					)}
					<Text
						numberOfLines={2}
						className="font-ui-semibold text-[17px] text-text md:font-ui md:text-[15px]"
					>
						{props.item.title}
					</Text>
					{props.item.primaryMetadata && (
						<SavedViewValue
							value={props.item.primaryMetadata}
							className="font-ui text-[13px] text-text-muted"
						/>
					)}
					{props.item.secondaryMetadata && (
						<SavedViewValue
							value={props.item.secondaryMetadata}
							className="font-ui text-xs text-text-subtle"
						/>
					)}
				</View>
				{props.item.callout && (
					<SavedViewValue
						value={props.item.callout}
						className="max-w-24 font-ui-semibold text-sm text-accent-text"
					/>
				)}
			</Pressable>
		</Link>
	);
}

export function SavedViewList(props: {
	items: readonly SavedViewCardItem[];
	managedUrls: ReadonlyMap<string, string>;
}) {
	return (
		<View className="border-t border-border">
			{props.items.map((item) => (
				<SavedViewListRow key={item.entityId} item={item} managedUrls={props.managedUrls} />
			))}
		</View>
	);
}
