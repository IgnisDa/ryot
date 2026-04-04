import { MissingImage, RemoteImage } from "@/modules/ui/image-with-fallback";

import type { SavedViewImage } from "./display-data";
import { resolveSavedViewImageUrl } from "./display-data";

export function SavedViewImageView(props: {
	className: string;
	onError?: () => void;
	image: SavedViewImage;
	managedUrls: ReadonlyMap<string, string>;
}) {
	if (props.image.type === "unconfigured") {
		return null;
	}
	const url = resolveSavedViewImageUrl(props.image, props.managedUrls);
	if (!url) {
		return <MissingImage className={props.className} />;
	}
	return <RemoteImage key={url} className={props.className} url={url} onError={props.onError} />;
}
