import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { getColors } from "react-native-image-colors";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import type { SavedViewImage } from "./display-data";
import { resolveSavedViewImageUrl } from "./display-data";
import {
	SAVED_VIEW_COLOR_FALLBACK,
	deriveSavedViewTint,
	getSavedViewTintGradientStops,
} from "./saved-view-tint";

const TINT_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);

export function useSavedViewTint(props: {
	image: SavedViewImage;
	managedUrls: ReadonlyMap<string, string>;
}) {
	const url = resolveSavedViewImageUrl(props.image, props.managedUrls);
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
				key: url,
				cache: true,
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

	return {
		gradientStops,
		onImageError: () => {
			if (!url || currentUrl.current !== url) {
				return;
			}
			failedUrl.current = url;
			setGradientStops(undefined);
		},
	};
}

export function SavedViewTintOverlay(props: { gradientStops?: readonly [string, string, string] }) {
	if (!props.gradientStops) {
		return null;
	}
	return (
		<Animated.View pointerEvents="none" entering={TINT_ENTERING} className="absolute inset-0">
			<LinearGradient
				style={{ flex: 1 }}
				end={{ x: 1, y: 0.5 }}
				start={{ x: 0, y: 0.5 }}
				locations={[0, 0.45, 1]}
				colors={props.gradientStops}
			/>
		</Animated.View>
	);
}
