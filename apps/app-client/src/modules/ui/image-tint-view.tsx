import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { getColors } from "react-native-image-colors";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import {
	IMAGE_TINT_COLOR_FALLBACK,
	deriveImageTint,
	getImageTintGradientStops,
} from "./image-tint";

const TINT_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);

const GRADIENT_EDGES = {
	vertical: { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
	horizontal: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
} as const;

export function useImageTint(url: string | undefined) {
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
				fallback: IMAGE_TINT_COLOR_FALLBACK,
			})
				.then((colors) => {
					if (!active || failedUrl.current === url) {
						return undefined;
					}
					const tint = deriveImageTint(colors);
					setGradientStops(tint ? getImageTintGradientStops(tint) : undefined);
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

export function ImageTintOverlay(props: {
	readonly direction: "horizontal" | "vertical";
	readonly gradientStops?: readonly [string, string, string];
}) {
	if (!props.gradientStops) {
		return null;
	}
	const edges = GRADIENT_EDGES[props.direction];
	return (
		<Animated.View pointerEvents="none" entering={TINT_ENTERING} className="absolute inset-0">
			<LinearGradient
				end={edges.end}
				start={edges.start}
				style={{ flex: 1 }}
				locations={[0, 0.45, 1]}
				colors={props.gradientStops}
			/>
		</Animated.View>
	);
}
