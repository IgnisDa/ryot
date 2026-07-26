import { View } from "react-native";

import { useHeaderContentOffset } from "@/modules/navigation/header/use-header-content-offset";
import { ImageTintOverlay, useImageTint } from "@/modules/ui/image-tint-view";
import { useManagedAssetUrl } from "@/modules/ui/managed-asset-context";

import { showPosterAsset, type ShowSummary } from "./show-summary-state";

const TINT_HEIGHT = 320;

export function ShowTint(props: { readonly show: ShowSummary }) {
	const offset = useHeaderContentOffset();
	const asset = showPosterAsset(props.show);
	const { gradientStops } = useImageTint(useManagedAssetUrl(asset));
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
