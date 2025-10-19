import { Menu } from "lucide-react-native";
import type { ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import {
	useNavigationData,
	useNavSheetOpen,
	useSetNavSheetOpen,
	useSubFlyoutOpen,
} from "@/lib/navigation";

import { ShellRail } from "./rail";
import { ShellSubFlyout } from "./sub-flyout";
import { TrackerSheet } from "./tracker-sheet";

const TABLET_BREAKPOINT = 768;

type Props = { children: ReactNode };

export function ShellNavigation({ children }: Props) {
	const insets = useSafeAreaInsets();
	const navSheetOpen = useNavSheetOpen();
	const { trackers } = useNavigationData();
	const subFlyoutOpen = useSubFlyoutOpen();
	const setNavSheetOpen = useSetNavSheetOpen();
	const { width: screenWidth } = useWindowDimensions();

	const isTablet = screenWidth >= TABLET_BREAKPOINT;
	const menuTrigger = isTablet ? null : (
		<Box className="absolute right-7 z-50" style={{ top: insets.top + 16 }}>
			<Pressable
				className="-mr-1 p-1"
				accessibilityRole="button"
				accessibilityLabel="Open navigation"
				onPress={() => setNavSheetOpen(true)}
			>
				<Menu size={20} color="#78716c" strokeWidth={1.5} />
			</Pressable>
		</Box>
	);

	if (!trackers.length) {
		return children;
	}

	const layout = isTablet ? (
		<Box className="flex-1 flex-row">
			<Box className="flex-1">{children}</Box>
			{subFlyoutOpen && <ShellSubFlyout />}
			<ShellRail pinned onClose={() => {}} />
		</Box>
	) : (
		<Box className="flex-1">
			{children}
			{menuTrigger}
			{navSheetOpen && <TrackerSheet />}
		</Box>
	);

	return <Box className="flex-1">{layout}</Box>;
}
