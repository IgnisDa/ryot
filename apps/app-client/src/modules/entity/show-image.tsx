import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import clsx from "clsx";
import { View } from "react-native";

import { MissingImage, RemoteImage } from "@/modules/ui/image-with-fallback";
import { resolveAssetUrl } from "@/modules/ui/managed-assets";

export function ShowAssetImage(props: {
	readonly className: string;
	readonly shape?: "rounded" | "circle";
	readonly asset: AssetLocator | undefined;
	readonly managedUrls: ReadonlyMap<string, string>;
}) {
	const url = props.asset ? resolveAssetUrl(props.asset, props.managedUrls) : undefined;
	return (
		<View
			className={clsx(
				props.className,
				"overflow-hidden bg-surface-2",
				props.shape === "circle" ? "rounded-full" : "rounded-lg",
			)}
		>
			{url ? (
				<RemoteImage key={url} url={url} className="h-full w-full" />
			) : (
				<MissingImage className="h-full w-full" />
			)}
		</View>
	);
}
