import clsx from "clsx";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { getEntityHref } from "@/modules/navigation/navigation-data";
import { ImageTintOverlay, useImageTint } from "@/modules/ui/image-tint-view";
import { useManagedAssetUrl } from "@/modules/ui/managed-asset-context";

import type { SavedViewTableItem } from "./display-data";
import { formatSavedViewValue } from "./display-value";
import { SavedViewImageView } from "./saved-view-image";

const columnClassName = (index: number) =>
	index === 0 ? "min-w-0 flex-1" : "w-16 shrink-0 md:w-28";

function SavedViewTableRow(props: { item: SavedViewTableItem }) {
	const image = props.item.image;
	const url = useManagedAssetUrl(image.type === "asset" ? image.locator : undefined);
	const { gradientStops, onImageError } = useImageTint(url);

	return (
		<Link asChild href={getEntityHref(props.item.entityId)}>
			<Pressable
				accessibilityRole="link"
				className="relative h-15 flex-row items-center gap-3 overflow-hidden border-b border-border focus-visible:outline-2 focus-visible:outline-accent md:gap-4"
			>
				<ImageTintOverlay direction="horizontal" gradientStops={gradientStops} />
				{props.item.cells.map((cell, index) => (
					<View
						key={`${props.item.entityId}:${cell.key}`}
						className={clsx(
							columnClassName(index),
							"justify-center",
							index === 0 && "flex-row items-center gap-3",
						)}
					>
						<Link.AppleZoom>
							<SavedViewImageView
								collapsable={false}
								onError={onImageError}
								image={props.item.image}
								className="h-13 w-9 shrink-0 rounded-sm bg-surface-2"
							/>
						</Link.AppleZoom>
						<Text
							numberOfLines={1}
							className={
								index === 0
									? "min-w-0 flex-1 font-ui text-[15px] text-text"
									: "min-w-0 font-ui text-right text-sm text-text-muted"
							}
						>
							{formatSavedViewValue(cell.value)}
						</Text>
					</View>
				))}
			</Pressable>
		</Link>
	);
}

export function SavedViewTable(props: { items: readonly SavedViewTableItem[] }) {
	const headers = props.items[0]?.cells ?? [];
	return (
		<View className="w-full max-w-6xl">
			<View className="h-8.5 flex-row items-center gap-3 border-b border-border md:gap-4">
				{headers.map((cell, index) => (
					<View key={cell.key} className={clsx(columnClassName(index), "justify-center")}>
						<Text
							className={clsx(
								"font-ui-semibold text-[11.5px] uppercase tracking-[0.6px] text-text-subtle",
								index > 0 && "text-right",
							)}
							numberOfLines={1}
						>
							{cell.label}
						</Text>
					</View>
				))}
			</View>
			{props.items.map((item) => (
				<SavedViewTableRow key={item.entityId} item={item} />
			))}
		</View>
	);
}
