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

export function SavedViewList(props: {
	items: readonly SavedViewCardItem[];
	managedUrls: ReadonlyMap<string, string>;
}) {
	return (
		<View className="border-t border-border">
			{props.items.map((item) => (
				<View
					key={item.id}
					className="min-h-28 flex-row items-center gap-3 border-b border-border py-2 md:min-h-18 md:gap-3.5 md:px-1"
				>
					<SavedViewImageView
						image={item.image}
						managedUrls={props.managedUrls}
						className="h-24 w-16 rounded-md bg-surface-2 md:h-16 md:w-11 md:rounded-sm"
					/>
					<View className="min-w-0 flex-1 gap-0.5">
						{item.overline && (
							<Value
								value={item.overline}
								className="font-ui-medium text-[11px] uppercase tracking-wide text-text-subtle"
							/>
						)}
						<Text
							className="font-ui-semibold text-[17px] text-text md:font-ui md:text-[15px]"
							numberOfLines={2}
						>
							{item.title}
						</Text>
						{item.primaryMetadata && (
							<Value value={item.primaryMetadata} className="font-ui text-[13px] text-text-muted" />
						)}
						{item.secondaryMetadata && (
							<Value value={item.secondaryMetadata} className="font-ui text-xs text-text-subtle" />
						)}
					</View>
					{item.callout && (
						<Value
							value={item.callout}
							className="max-w-24 font-ui-semibold text-sm text-accent-text"
						/>
					)}
				</View>
			))}
		</View>
	);
}
