import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";

import { useHeaderContentOffset } from "@/modules/navigation/header/use-header-content-offset";
import { withPageAlpha } from "@/modules/theme/page-background-color";
import { usePageBackgroundColor } from "@/modules/theme/use-page-background-color";
import { RemoteImage } from "@/modules/ui/image-with-fallback";
import { resolveAssetUrl } from "@/modules/ui/managed-assets";

import { showBackdropAsset, type ShowSummary } from "./show-summary-state";

export const SHOW_ART_HEIGHT = 204;

const SCRIM_TOP_ALPHA = 0.35;

const SCRIM_MID_ALPHA = 0.7;

export function ShowHero(props: {
	readonly show: ShowSummary;
	readonly managedUrls: ReadonlyMap<string, string>;
}) {
	const offset = useHeaderContentOffset();
	const background = usePageBackgroundColor();
	const asset = showBackdropAsset(props.show);
	const url = asset ? resolveAssetUrl(asset, props.managedUrls) : undefined;
	if (!url) {
		return null;
	}
	return (
		<View
			pointerEvents="none"
			style={{ top: -offset, height: offset + SHOW_ART_HEIGHT }}
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
