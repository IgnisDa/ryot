import { Text, View } from "react-native";

import type { SavedViewCardItem, SavedViewScalarValue } from "./display-data";
import { formatSavedViewValue } from "./display-value";
import { SavedViewImageView } from "./saved-view-image";

function Value(props: { value: SavedViewScalarValue; className: string }) {
	return (
		<Text className={props.className} numberOfLines={1}>
			{formatSavedViewValue(props.value)}
		</Text>
	);
}

export function SavedViewGrid(props: {
	items: readonly SavedViewCardItem[];
	managedUrls: ReadonlyMap<string, string>;
}) {
	return (
		<View className="-mx-1.5 flex-row flex-wrap md:-mx-2.5">
			{props.items.map((item) => (
				<View
					key={item.id}
					className="w-1/2 gap-2 px-1.5 pb-5 sm:w-1/3 md:w-1/4 md:px-2.5 lg:w-1/5 xl:w-1/6"
				>
					<SavedViewImageView
						image={item.image}
						managedUrls={props.managedUrls}
						className="aspect-3/4 w-full rounded-lg bg-surface-2"
					/>
					<View className="gap-1">
						{item.overline && (
							<Value
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
							<Value value={item.primaryMetadata} className="font-ui text-xs text-text-muted" />
						)}
						{item.secondaryMetadata && (
							<Value value={item.secondaryMetadata} className="font-ui text-xs text-text-subtle" />
						)}
						{item.callout && (
							<Value value={item.callout} className="font-ui-semibold text-xs text-accent-text" />
						)}
					</View>
				</View>
			))}
		</View>
	);
}
