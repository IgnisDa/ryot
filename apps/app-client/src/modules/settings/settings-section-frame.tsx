import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";

export function SettingsSectionFrame(props: { title: string; children: ReactNode }) {
	return (
		<ChildScreenFrame title={props.title}>
			<View className="w-full max-w-2xl self-center">
				<Text className="mb-8 hidden font-display-semibold text-3xl text-text md:flex">
					{props.title}
				</Text>
				{props.children}
			</View>
		</ChildScreenFrame>
	);
}
