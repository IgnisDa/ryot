import type { ReactNode } from "react";
import { useEffect } from "react";
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
	const { trackers } = useNavigationData();
	const { activeTrackerSlug } = useActiveNav();
	const setSubFlyoutOpen = useSetSubFlyoutOpen();
	const { width: screenWidth } = useWindowDimensions();

	const activeTracker = trackers.find((t) => t.slug === activeTrackerSlug);
	const subItemCount = activeTracker?.subItems?.length;

	useEffect(() => {
		setSubFlyoutOpen((subItemCount ?? 0) > 0);
	}, [activeTracker?.key, setSubFlyoutOpen, subItemCount]);

	const isTablet = screenWidth >= TABLET_BREAKPOINT;

	if (!trackers.length) {
		return children;
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
