import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Text } from "@/components/ui/text";

type Props = { title: string; eyebrow: string; children?: ReactNode };

export function PageHeader(props: Props) {
	const insets = useSafeAreaInsets();

	return (
		<Box className="flex-1 bg-background">
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{
					paddingBottom: 40,
					paddingHorizontal: 28,
					paddingTop: insets.top + 16,
				}}
			>
				<Box className="h-7 md:hidden" />
				<Text className="text-[10px] mt-[14] tracking-[2px] text-muted-foreground font-sans uppercase">
					{props.eyebrow}
				</Text>
				<Text className="text-[38px] text-foreground mt-1 leading-[40px] font-heading-semibold tracking-[-0.5px]">
					{props.title}
				</Text>
				<Box className="h-[0.5px] mt-[18] bg-border" />
				{props.children}
			</ScrollView>
		</Box>
	);
}

export const gridStyles = {
	grid: "gap-3 mt-4 flex-wrap flex-row",
	card: "w-[46%] aspect-[2/3] bg-stone-200",
};
