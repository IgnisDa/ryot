import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HEADER_ROW_HEIGHT } from "@/modules/navigation/header/header-metrics";
import { withPageAlpha } from "@/modules/theme/page-background-color";
import { usePageBackgroundColor } from "@/modules/theme/use-page-background-color";
import { RemoteImage } from "@/modules/ui/image-with-fallback";
import { resolveAssetUrl } from "@/modules/ui/managed-assets";

import { showBackdropAsset, type ShowSummary } from "./show-summary-state";

const HERO_HEIGHT = 176;

const SCRIM_TOP_ALPHA = 0.35;

const SCRIM_MID_ALPHA = 0.7;

export function ShowHero(props: {
	readonly show: ShowSummary;
	readonly managedUrls: ReadonlyMap<string, string>;
}) {
	const insets = useSafeAreaInsets();
	const background = usePageBackgroundColor();
	const asset = showBackdropAsset(props.show);
	const url = asset ? resolveAssetUrl(asset, props.managedUrls) : undefined;
	if (!url) {
		return null;
	}
	const offset = insets.top + HEADER_ROW_HEIGHT;
	return (
		<View
			pointerEvents="none"
			style={{ top: -offset, height: offset + HERO_HEIGHT }}
			className="absolute inset-x-0 -mx-4 overflow-hidden md:hidden"
		>
			<RemoteImage key={url} url={url} className="h-full w-full" />
			<View className="absolute inset-0">
				<LinearGradient
					style={{ flex: 1 }}
					locations={[0, 0.55, 1]}
					colors={[
						withPageAlpha(background, SCRIM_TOP_ALPHA),
						withPageAlpha(background, SCRIM_MID_ALPHA),
						background,
					]}
				/>
			</View>
		</View>
	);
}
