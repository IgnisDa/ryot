import clsx from "clsx";
import { Image } from "expo-image";
import { styled } from "nativewind";
import { useState } from "react";
import { View } from "react-native";

import { AppIcon } from "@/modules/icons";

const StyledImage = styled(Image, {
	className: { target: "style" },
});

export function MissingImage(props: { className: string; collapsable?: boolean }) {
	return (
		<View
			collapsable={props.collapsable}
			className={clsx(props.className, "items-center justify-center bg-surface-2")}
		>
			<AppIcon className="text-text-subtle" name="image" size={22} />
		</View>
	);
}

export function ImageWithFallback(props: {
	readonly className: string;
	readonly onError?: () => void;
	readonly collapsable?: boolean;
	readonly url: string | undefined;
}) {
	return props.url === undefined ? (
		<MissingImage className={props.className} collapsable={props.collapsable} />
	) : (
		<RemoteImage
			key={props.url}
			url={props.url}
			onError={props.onError}
			className={props.className}
			collapsable={props.collapsable}
		/>
	);
}

export function RemoteImage(props: {
	url: string;
	className: string;
	onError?: () => void;
	collapsable?: boolean;
}) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <MissingImage className={props.className} collapsable={props.collapsable} />;
	}
	return (
		<StyledImage
			contentFit="cover"
			accessible={false}
			source={{ uri: props.url }}
			className={props.className}
			collapsable={props.collapsable}
			onError={() => {
				setFailed(true);
				props.onError?.();
			}}
		/>
	);
}
