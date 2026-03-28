import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { getColors } from "react-native-image-colors";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { getEntityHref } from "@/modules/navigation/navigation-data";

import type { SavedViewCardItem, SavedViewScalarValue } from "./display-data";
import { resolveSavedViewImageUrl } from "./display-data";
import { formatSavedViewValue } from "./display-value";
import { SavedViewImageView } from "./saved-view-image";
import {
	SAVED_VIEW_COLOR_FALLBACK,
	deriveSavedViewTint,
	getSavedViewTintGradientStops,
} from "./saved-view-tint";

const TINT_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);

function Value(props: { value: SavedViewScalarValue; className: string }) {
	return (
		<Text className={props.className} numberOfLines={1}>
			{formatSavedViewValue(props.value)}
		</Text>
	);
}

function SavedViewListRow(props: {
	item: SavedViewCardItem;
	managedUrls: ReadonlyMap<string, string>;
}) {
	const url = resolveSavedViewImageUrl(props.item.image, props.managedUrls);
	const currentUrl = useRef(url);
	const failedUrl = useRef<string | undefined>(undefined);
	const [gradientStops, setGradientStops] = useState<readonly [string, string, string]>();
	currentUrl.current = url;

	useEffect(() => {
		let active = true;
		failedUrl.current = undefined;
		setGradientStops(undefined);
		if (url) {
			void getColors(url, {
				cache: true,
				key: url,
				fallback: SAVED_VIEW_COLOR_FALLBACK,
			})
				.then((colors) => {
					if (!active || failedUrl.current === url) {
						return undefined;
					}
					const tint = deriveSavedViewTint(colors);
					setGradientStops(tint ? getSavedViewTintGradientStops(tint) : undefined);
					return undefined;
				})
				.catch(() => undefined);
		}

		return () => {
			active = false;
		};
	}, [url]);

	return (
		<Link asChild href={getEntityHref(props.item.entityId)}>
			<Pressable
				accessibilityRole="link"
				accessibilityLabel={`Open ${props.item.title}`}
				className="relative min-h-28 flex-row items-center gap-3 overflow-hidden border-b border-border py-2 focus-visible:outline-2 focus-visible:outline-accent md:min-h-18 md:gap-3.5 md:px-1"
			>
				{gradientStops && (
					<Animated.View pointerEvents="none" entering={TINT_ENTERING} className="absolute inset-0">
						<LinearGradient
							style={{ flex: 1 }}
							end={{ x: 1, y: 0.5 }}
							colors={gradientStops}
							start={{ x: 0, y: 0.5 }}
							locations={[0, 0.45, 1]}
						/>
					</Animated.View>
				)}
				<SavedViewImageView
					image={props.item.image}
					managedUrls={props.managedUrls}
					className="h-24 w-16 rounded-md bg-surface-2 md:h-16 md:w-11 md:rounded-sm"
					onError={() => {
						if (!url || currentUrl.current !== url) {
							return;
						}
						failedUrl.current = url;
						setGradientStops(undefined);
					}}
				/>
				<View className="min-w-0 flex-1 gap-0.5">
					{props.item.overline && (
						<Value
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
						<Value
							value={props.item.primaryMetadata}
							className="font-ui text-[13px] text-text-muted"
						/>
					)}
					{props.item.secondaryMetadata && (
						<Value
							value={props.item.secondaryMetadata}
							className="font-ui text-xs text-text-subtle"
						/>
					)}
				</View>
				{props.item.callout && (
					<Value
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
