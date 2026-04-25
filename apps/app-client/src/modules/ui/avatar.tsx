import clsx from "clsx";
import { View } from "react-native";

import { AppIcon } from "@/modules/icons";

import { RemoteImage } from "./image-with-fallback";

export function AppAvatar(props: {
	readonly className: string;
	readonly iconSize?: number;
	readonly url: string | null;
	readonly iconClassName?: string;
}) {
	return props.url === null ? (
		<View className={clsx(props.className, "items-center justify-center bg-surface-2")}>
			<AppIcon
				name="user"
				size={props.iconSize ?? 16}
				className={props.iconClassName ?? "text-text-subtle"}
			/>
		</View>
	) : (
		<RemoteImage key={props.url} url={props.url} className={props.className} />
	);
}
