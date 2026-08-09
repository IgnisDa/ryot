import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import clsx from "clsx";
import { View } from "react-native";

import { MissingImage, RemoteImage } from "@/modules/ui/image-with-fallback";
import { useManagedAssetUrl } from "@/modules/ui/managed-asset-context";

export function ShowAssetImage(props: {
	readonly className: string;
	readonly shape?: "rounded" | "circle";
	readonly asset: AssetLocator | undefined;
}) {
	const url = useManagedAssetUrl(props.asset);
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
