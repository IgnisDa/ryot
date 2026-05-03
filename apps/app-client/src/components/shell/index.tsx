import { usePathname } from "expo-router";
import { type ReactNode, useEffect } from "react";
import { useWindowDimensions } from "react-native";
import { Box } from "@/components/ui/box";
import {
	useNavigationData,
	useNavSheetOpen,
	useSetSubFlyoutOpen,
	useSubFlyoutOpen,
} from "@/lib/navigation";
import { ShellRail } from "./rail";
import { ShellSubFlyout } from "./sub-flyout";
import { TrackerSheet } from "./tracker-sheet";

const TABLET_BREAKPOINT = 768;

type Props = { children: ReactNode };

export function ShellNavigation({ children }: Props) {
	const pathname = usePathname();
	const navSheetOpen = useNavSheetOpen();
	const subFlyoutOpen = useSubFlyoutOpen();
	const setSubFlyoutOpen = useSetSubFlyoutOpen();
	const { trackers } = useNavigationData();
	const { width: screenWidth } = useWindowDimensions();
	const segments = pathname.split("/").filter(Boolean);
	const isViewPath = segments[0] === "views";
	const trackerSlug = isViewPath
		? (trackers.find((t) => t.subItems.some((s) => s.slug === segments[1]))
				?.slug ?? "home")
		: segments[0] || "home";
	const activeTracker = trackers.find((t) => t.slug === trackerSlug);

	useEffect(() => {
		setSubFlyoutOpen((activeTracker?.subItems?.length ?? 0) > 0);
	}, [activeTracker?.key]);

	const isTablet = screenWidth >= TABLET_BREAKPOINT;

	if (!trackers.length) {
		return <>{children}</>;
	}

	const layout = isTablet ? (
		<Box className="flex-1 flex-row">
			<Box className="flex-1">{children}</Box>
			{subFlyoutOpen && <ShellSubFlyout pinned />}
			<ShellRail pinned onClose={() => {}} />
		</Box>
	) : (
		<Box className="flex-1">
			{children}
			{navSheetOpen && <TrackerSheet />}
		</Box>
	);

	return <Box className="flex-1">{layout}</Box>;
}
