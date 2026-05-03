import type { ReactNode } from "react";
import { View } from "react-native";

import { HeaderLeadingControl } from "@/modules/navigation/header/header-control";
import { HeaderFrame } from "@/modules/navigation/header/header-frame";

export function ShowScreenFrame(props: {
	readonly title: string;
	readonly onBack: () => void;
	readonly children: ReactNode;
	readonly backdrop?: ReactNode;
}) {
	return (
		<HeaderFrame
			hideLargeTitle
			title={props.title}
			leading={<HeaderLeadingControl icon="chevron-left" label="Go back" onPress={props.onBack} />}
		>
			{props.backdrop}
			<View className="mx-auto w-full max-w-6xl gap-4">{props.children}</View>
		</HeaderFrame>
	);
}
