import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

import { WorkspaceScrollFrame } from "./workspace-scroll-frame";

const TOP_BAR_HEIGHT = 44;

export function WorkspaceDetailFrame(props: { children: ReactNode; title: string }) {
	const router = useRouter();

	function goBack() {
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace("/");
	}

	return (
		<WorkspaceScrollFrame
			headerClassName="px-4"
			headerHeight={TOP_BAR_HEIGHT}
			header={
				<View className="h-11 flex-row items-center gap-2.5">
					<Pressable
						onPress={goBack}
						accessibilityRole="button"
						accessibilityLabel="Go back"
						className="h-8 w-8 items-center justify-center rounded-pill bg-surface-2"
					>
						<AppIcon className="text-text" name="chevron-left" size={17} />
					</Pressable>
					<Text numberOfLines={1} className="min-w-0 flex-1 font-ui-semibold text-[19px] text-text">
						{props.title}
					</Text>
				</View>
			}
		>
			{props.children}
		</WorkspaceScrollFrame>
	);
}
