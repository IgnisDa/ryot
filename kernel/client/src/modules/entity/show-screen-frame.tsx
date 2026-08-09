import type { ReactNode } from "react";
import { View } from "react-native";

import { HeaderLeadingControl } from "@/modules/navigation/header/header-control";
import { HeaderFrame } from "@/modules/navigation/header/header-frame";
import { HEADER_ROW_HEIGHT } from "@/modules/navigation/header/header-metrics";

export function ShowScreenFrame(props: {
	readonly title: string;
	readonly tint?: ReactNode;
	readonly onBack: () => void;
	readonly artHeight?: number;
	readonly children: ReactNode;
	readonly artwork?: ReactNode;
}) {
	return (
		<HeaderFrame
			hideLargeTitle
			title={props.title}
			heroHeight={props.artHeight === undefined ? undefined : props.artHeight + HEADER_ROW_HEIGHT}
			leading={<HeaderLeadingControl icon="chevron-left" label="Go back" onPress={props.onBack} />}
		>
			{props.tint}
			{props.artwork}
			<View className="mx-auto w-full max-w-6xl gap-4 pt-3 md:pt-0">{props.children}</View>
		</HeaderFrame>
	);
}
