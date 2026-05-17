import { Menu } from "lucide-react-native";
import type { ReactNode } from "react";
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
type Props = { children: ReactNode };

export function ShellNavigation(props: Props) {
	const insets = useSafeAreaInsets();
	const navSheetOpen = useNavSheetOpen();
	const { trackers } = useNavigationData();
	const subFlyoutOpen = useSubFlyoutOpen();
	const setNavSheetOpen = useSetNavSheetOpen();

	if (!trackers.length) {
		return props.children;
	}

	return (
		<Box className="relative flex-1 md:flex-row">
			<Box className="flex-1">
				<Box className="flex-1 web:mx-auto web:w-full web:max-w-4xl">{props.children}</Box>
			</Box>
			<Box className="hidden h-full self-stretch md:flex md:flex-none">
				{subFlyoutOpen && <ShellSubFlyout />}
				<ShellRail pinned onClose={() => {}} />
			</Box>
			<Box className="absolute inset-0 md:hidden" pointerEvents="box-none">
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
				{navSheetOpen && <TrackerSheet />}
			</Box>
		</Box>
	);
}
