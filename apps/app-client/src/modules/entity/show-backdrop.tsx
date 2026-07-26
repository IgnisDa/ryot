import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";

import { withPageAlpha } from "@/modules/theme/page-background-color";
import { usePageBackgroundColor } from "@/modules/theme/use-page-background-color";
import { RemoteImage } from "@/modules/ui/image-with-fallback";
import { useManagedAssetUrl } from "@/modules/ui/managed-asset-context";

import { showBackdropAsset, type ShowSummary } from "./show-summary-state";

const SCRIM_OPACITY = 0.7;

const SCRIM_HOLD_STOP = 0.35;

export function ShowBackdrop(props: { readonly show: ShowSummary }) {
	const background = usePageBackgroundColor();
	const asset = showBackdropAsset(props.show);
	const url = useManagedAssetUrl(asset);
	if (!url) {
		return null;
	}
	const scrim = withPageAlpha(background, SCRIM_OPACITY);
	return (
		<View
			pointerEvents="none"
			className="absolute inset-x-0 top-0 -mx-4 hidden h-80 overflow-hidden md:-mx-8 md:-mt-8 md:flex md:h-104"
		>
			<RemoteImage key={url} url={url} className="h-full w-full" />
			<View className="absolute inset-0">
				<LinearGradient
					style={{ flex: 1 }}
					colors={[scrim, scrim, background]}
					locations={[0, SCRIM_HOLD_STOP, 1]}
				/>
			</View>
		</View>
	);
}
