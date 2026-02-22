import { type ReactNode, useEffect } from "react";
import { useWindowDimensions } from "react-native";
import { Box } from "@/components/ui/box";
import {
	useActiveNav,
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
	const navSheetOpen = useNavSheetOpen();
	const subFlyoutOpen = useSubFlyoutOpen();
	const setSubFlyoutOpen = useSetSubFlyoutOpen();
	const { trackers } = useNavigationData();
	const { width: screenWidth } = useWindowDimensions();
	const { activeTrackerSlug } = useActiveNav();
	const activeTracker = trackers.find((t) => t.slug === activeTrackerSlug);

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
