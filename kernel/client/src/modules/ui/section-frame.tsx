import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";
import type { HeaderOverflowItem } from "@/modules/navigation/header/header-overflow-menu";

export function SectionFrame(props: {
	readonly title: string;
	readonly children: ReactNode;
	readonly contentClassName?: string;
	readonly overflowItems?: readonly HeaderOverflowItem[];
}) {
	return (
		<ChildScreenFrame title={props.title} overflowItems={props.overflowItems}>
			<View className={props.contentClassName ?? "w-full max-w-2xl self-center"}>
				<Text className="mb-8 hidden font-display-semibold text-3xl text-text md:flex">
					{props.title}
				</Text>
				{props.children}
			</View>
		</ChildScreenFrame>
	);
}
