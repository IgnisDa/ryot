import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import clsx from "clsx";
import { View } from "react-native";

import { ManagedAssetImage } from "@/modules/ui/managed-asset-context";

export function ShowAssetImage(props: {
	readonly className: string;
	readonly collapsable?: boolean;
	readonly shape?: "rounded" | "circle";
	readonly asset: AssetLocator | undefined;
}) {
	return (
		<View
			collapsable={props.collapsable}
			className={clsx(
				props.className,
				"overflow-hidden bg-surface-2",
				props.shape === "circle" ? "rounded-full" : "rounded-lg",
			)}
		>
			<ManagedAssetImage asset={props.asset} className="h-full w-full" />
		</View>
	);
}
