import { Menu } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BreadcrumbChip } from "@/components/shell/breadcrumb-chip";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useSetNavSheetOpen } from "@/lib/navigation";

const TABLET_BREAKPOINT = 768;

type Props = { title: string; eyebrow: string; children?: ReactNode };

export function PageHeader({ eyebrow, title, children }: Props) {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const isTablet = width >= TABLET_BREAKPOINT;
	const setNavSheetOpen = useSetNavSheetOpen();

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
				<Box className="flex-row items-center">
					<BreadcrumbChip />
					<Box className="flex-1" />
					{!isTablet && (
						<Pressable
							className="p-1 -mr-1"
							accessibilityRole="button"
							accessibilityLabel="Open navigation"
							onPress={() => setNavSheetOpen(true)}
						>
							<Menu size={20} color="#78716c" strokeWidth={1.5} />
						</Pressable>
					)}
				</Box>
				<Text className="text-[10px] mt-[14] tracking-[2px] text-muted-foreground font-sans uppercase">
					{eyebrow}
				</Text>
				<Text className="text-[38px] text-foreground mt-1 leading-[40px] font-heading-semibold tracking-[-0.5px]">
					{title}
				</Text>
				<Box className="h-[0.5px] mt-[18] bg-border" />
				{children}
			</ScrollView>
		</Box>
	);
}

export const gridStyles = {
	grid: "gap-3 mt-4 flex-wrap flex-row",
	card: "w-[46%] aspect-[2/3] bg-stone-200",
};
