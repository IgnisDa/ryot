import clsx from "clsx";
import { Image } from "expo-image";
import { styled } from "nativewind";
import { useState } from "react";
import { View } from "react-native";

import { AppIcon } from "@/modules/icons";

const StyledImage = styled(Image, {
	className: { target: "style" },
});

export function MissingImage(props: { className: string }) {
	return (
		<View className={clsx(props.className, "items-center justify-center bg-surface-2")}>
			<AppIcon className="text-text-subtle" name="image" size={22} />
		</View>
	);
}

export function ImageWithFallback(props: {
	readonly className: string;
	readonly url: string | undefined;
	readonly onError?: () => void;
}) {
	return props.url === undefined ? (
		<MissingImage className={props.className} />
	) : (
		<RemoteImage
			key={props.url}
			url={props.url}
			onError={props.onError}
			className={props.className}
		/>
	);
}

export function RemoteImage(props: { className: string; url: string; onError?: () => void }) {
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
			onError={() => {
				setFailed(true);
				props.onError?.();
			}}
		/>
	);
}
