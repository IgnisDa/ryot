import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { getEntityHref } from "@/modules/navigation/navigation-data";

import type { SavedViewCardItem } from "./display-data";
import { SavedViewImageView } from "./saved-view-image";
import { SavedViewValue } from "./saved-view-value";

export function SavedViewGrid(props: {
	items: readonly SavedViewCardItem[];
	managedUrls: ReadonlyMap<string, string>;
}) {
	return (
		<View className="-mx-1.5 flex-row flex-wrap md:-mx-2.5">
			{props.items.map((item) => (
				<Link asChild key={item.entityId} href={getEntityHref(item.entityId)}>
					<Pressable
						accessibilityRole="link"
						accessibilityLabel={`Open ${item.title}`}
						className="w-1/2 gap-2 rounded-lg px-1.5 pb-5 focus-visible:outline-2 focus-visible:outline-accent sm:w-1/3 md:w-1/4 md:px-2.5 lg:w-1/5 xl:w-1/6"
					>
						<Link.AppleZoom>
							<SavedViewImageView
								image={item.image}
								managedUrls={props.managedUrls}
								className="aspect-3/4 w-full rounded-lg bg-surface-2"
							/>
						</Link.AppleZoom>
						<View className="gap-1">
							{item.overline && (
								<SavedViewValue
									value={item.overline}
									className="font-ui-medium text-[11px] uppercase tracking-wide text-text-subtle"
								/>
							)}
							<Text
								numberOfLines={2}
								className="font-ui-semibold text-base text-text md:font-ui md:text-sm"
							>
								{item.title}
							</Text>
							{item.primaryMetadata && (
								<SavedViewValue
									value={item.primaryMetadata}
									className="font-ui text-xs text-text-muted"
								/>
							)}
							{item.secondaryMetadata && (
								<SavedViewValue
									value={item.secondaryMetadata}
									className="font-ui text-xs text-text-subtle"
								/>
							)}
							{item.callout && (
								<SavedViewValue
									value={item.callout}
									className="font-ui-semibold text-xs text-accent-text"
								/>
							)}
						</View>
					</Pressable>
				</Link>
			))}
		</View>
	);
}
