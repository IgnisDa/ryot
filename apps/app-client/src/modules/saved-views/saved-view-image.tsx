import clsx from "clsx";
import { Image } from "expo-image";
import { styled } from "nativewind";
import { useState } from "react";
import { View } from "react-native";

import { AppIcon } from "@/modules/icons";

import type { SavedViewImage } from "./display-data";
import { resolveSavedViewImageUrl } from "./display-data";

const StyledImage = styled(Image, {
	className: { target: "style" },
});

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
		<StyledImage
			contentFit="cover"
			accessible={false}
			source={{ uri: props.url }}
			className={props.className}
			onError={() => setFailed(true)}
		/>
	);
}

export function SavedViewImageView(props: {
	className: string;
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
	return <RemoteImage key={url} className={props.className} url={url} />;
}
