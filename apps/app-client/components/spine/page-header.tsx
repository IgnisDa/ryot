import { useSetAtom } from "jotai";
import { Menu } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BreadcrumbChip } from "@/components/spine/breadcrumb-chip";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { navSheetOpenAtom } from "@/lib/navigation";

const TABLET_BREAKPOINT = 768;

type Props = {
	eyebrow: string;
	title: string;
	children?: ReactNode;
};

export function PageHeader({ eyebrow, title, children }: Props) {
	const { width } = useWindowDimensions();
	const isTablet = width >= TABLET_BREAKPOINT;
	const setNavSheetOpen = useSetAtom(navSheetOpenAtom);

	return (
		<Box className="flex-1 bg-paper">
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{
					paddingTop: 110,
					paddingBottom: 40,
					paddingHorizontal: 28,
				}}
			>
				<SafeAreaView>
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
								<Menu size={20} color="#8a8378" strokeWidth={1.5} />
							</Pressable>
						)}
					</Box>
					<Text className="text-[10px] mt-[14] tracking-[2px] text-ink-soft font-sans uppercase">
						{eyebrow}
					</Text>
					<Text className="text-[38px] text-ink mt-1 leading-[40px] font-serif tracking-[-0.5px]">
						{title}
					</Text>
					<Box className="h-[0.5px] mt-[18] bg-ink/20" />
					{children}
				</SafeAreaView>
			</ScrollView>
		</Box>
	);
}

export const gridStyles = {
	grid: "gap-3 mt-4 flex-wrap flex-row",
	card: "w-[46%] aspect-[2/3] bg-paper-deep",
};
