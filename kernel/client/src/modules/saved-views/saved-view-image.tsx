import { ManagedAssetImage } from "@/modules/ui/managed-asset-context";

import type { SavedViewImage } from "./display-data";

export function SavedViewImageView(props: {
	className: string;
	onError?: () => void;
	collapsable?: boolean;
	image: SavedViewImage;
}) {
	if (props.image.type === "unconfigured") {
		return null;
	}
	return (
		<ManagedAssetImage
			onError={props.onError}
			className={props.className}
			collapsable={props.collapsable}
			asset={props.image.type === "asset" ? props.image.locator : undefined}
		/>
	);
}
