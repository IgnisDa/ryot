import clsx from "clsx";
import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

import { AppIcon } from "@/modules/icons";

import type { SavedViewImage } from "./display-data";

function MissingImage(props: { className: string }) {
	return (
		<View className={clsx(props.className, "items-center justify-center bg-surface-2")}>
			<AppIcon className="text-text-subtle" name="image" size={22} />
		</View>
	);
}

function RemoteImage(props: { className: string; url: string }) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <MissingImage className={props.className} />;
	}
	return (
		<Image
			accessible={false}
			contentFit="cover"
			source={{ uri: props.url }}
			className={props.className}
			onError={() => setFailed(true)}
		/>
	);
}

export function SavedViewImageView(props: { className: string; image: SavedViewImage }) {
	if (props.image.type === "unconfigured") {
		return null;
	}
	if (props.image.type === "missing") {
		return <MissingImage className={props.className} />;
	}
	return <RemoteImage key={props.image.url} className={props.className} url={props.image.url} />;
}
