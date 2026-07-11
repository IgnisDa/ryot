import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";

import { useHeaderContentOffset } from "@/modules/navigation/header/use-header-content-offset";
import { withPageAlpha } from "@/modules/theme/page-background-color";
import { usePageBackgroundColor } from "@/modules/theme/use-page-background-color";
import { RemoteImage } from "@/modules/ui/image-with-fallback";
import { useManagedAssetUrl } from "@/modules/ui/managed-asset-context";

import { showBackdropAsset, type ShowSummary } from "./show-summary-state";

export const SHOW_ART_HEIGHT = 204;

const SCRIM_MID_STOP = 0.5;

const SCRIM_TOP_ALPHA = 0.35;

const SCRIM_MID_ALPHA = 0.7;

const SCRIM_FADE_ALPHA = 0.92;

const SCRIM_FADE_HEIGHT = 76;

export function ShowHero(props: { readonly show: ShowSummary }) {
	const offset = useHeaderContentOffset();
	const background = usePageBackgroundColor();
	const asset = showBackdropAsset(props.show);
	const url = useManagedAssetUrl(asset);
	if (!url) {
		return null;
	}
	const artStop = offset + SHOW_ART_HEIGHT;
	const height = artStop + SCRIM_FADE_HEIGHT;
	return (
		<View
			pointerEvents="none"
			style={{ top: -offset, height }}
			className="absolute inset-x-0 -mx-4 overflow-hidden md:hidden"
		>
			<RemoteImage key={url} url={url} className="h-full w-full" />
			<View className="absolute inset-0">
				<LinearGradient
					style={{ flex: 1 }}
					locations={[0, SCRIM_MID_STOP, artStop / height, 1]}
					colors={[
						withPageAlpha(background, SCRIM_TOP_ALPHA),
						withPageAlpha(background, SCRIM_MID_ALPHA),
						withPageAlpha(background, SCRIM_FADE_ALPHA),
						background,
					]}
				/>
			</View>
		</View>
	);
}
