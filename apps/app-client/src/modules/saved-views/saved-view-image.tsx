import { MissingImage, RemoteImage } from "@/modules/ui/image-with-fallback";
import { useManagedAssetUrl } from "@/modules/ui/managed-asset-context";

import type { SavedViewImage } from "./display-data";

export function SavedViewImageView(props: {
	className: string;
	onError?: () => void;
	image: SavedViewImage;
}) {
	const url = useManagedAssetUrl(props.image.type === "asset" ? props.image.locator : undefined);
	if (props.image.type === "unconfigured") {
		return null;
	}
	if (!url) {
		return <MissingImage className={props.className} />;
	}
	return <RemoteImage key={url} className={props.className} url={url} onError={props.onError} />;
}
