import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HEADER_ROW_HEIGHT } from "@/modules/navigation/header/header-metrics";
import { ImageTintOverlay, useImageTint } from "@/modules/ui/image-tint-view";
import { resolveAssetUrl } from "@/modules/ui/managed-assets";

import { showPosterAsset, type ShowSummary } from "./show-summary-state";

const TINT_HEIGHT = 320;

export function ShowTint(props: {
	readonly show: ShowSummary;
	readonly managedUrls: ReadonlyMap<string, string>;
}) {
	const insets = useSafeAreaInsets();
	const asset = showPosterAsset(props.show);
	const { gradientStops } = useImageTint(
		asset ? resolveAssetUrl(asset, props.managedUrls) : undefined,
	);
	const offset = insets.top + HEADER_ROW_HEIGHT;
	return (
		<View
			pointerEvents="none"
			style={{ top: -offset, height: TINT_HEIGHT + offset }}
			className="absolute inset-x-0 -mx-4 overflow-hidden md:-mx-8"
		>
			<ImageTintOverlay direction="vertical" gradientStops={gradientStops} />
		</View>
	);
}
