import { MissingImage, RemoteImage } from "@/modules/ui/image-with-fallback";
import { resolveAssetUrl } from "@/modules/ui/managed-assets";

import type { SavedViewImage } from "./display-data";

export function SavedViewImageView(props: {
	className: string;
	onError?: () => void;
	image: SavedViewImage;
	managedUrls: ReadonlyMap<string, string>;
}) {
	if (props.image.type === "unconfigured") {
		return null;
	}
	const url =
		props.image.type === "asset"
			? resolveAssetUrl(props.image.locator, props.managedUrls)
			: undefined;
	if (!url) {
		return <MissingImage className={props.className} />;
	}
	return <RemoteImage key={url} className={props.className} url={url} onError={props.onError} />;
}
