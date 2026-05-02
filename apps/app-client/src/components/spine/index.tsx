import { usePathname } from "expo-router";
import type { ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { Box } from "@/components/ui/box";
import {
	useNavigationData,
	useNavSheetOpen,
	useSearchOpen,
} from "@/lib/navigation";
import { SpineRail } from "./rail";
import { SearchOverlay } from "./search-overlay";
import { SpineSubFlyout } from "./sub-flyout";
import { TrackerSheet } from "./tracker-sheet";

const TABLET_BREAKPOINT = 768;

type Props = { children: ReactNode };

export function SpineNavigation({ children }: Props) {
	const pathname = usePathname();
	const searchOpen = useSearchOpen();
	const navSheetOpen = useNavSheetOpen();
	const { trackers } = useNavigationData();
	const { width: screenWidth } = useWindowDimensions();
	const segments = pathname.split("/").filter(Boolean);
	const trackerSlug = segments[0] || "home";
	const isSubRoute = segments.length >= 2;
	const activeTracker = trackers.find((t) => t.slug === trackerSlug);
	const subFlyoutOpen =
		(activeTracker?.subItems?.length ?? 0) > 0 && !isSubRoute;

	const isTablet = screenWidth >= TABLET_BREAKPOINT;

	if (!trackers.length) {
		return <>{children}</>;
	}

	const layout = isTablet ? (
		<Box className="flex-1 flex-row">
			<Box className="flex-1">{children}</Box>
			{subFlyoutOpen && <SpineSubFlyout pinned />}
			<SpineRail pinned onClose={() => {}} />
		</Box>
	) : (
		<Box className="flex-1">
			{children}
			{navSheetOpen && <TrackerSheet />}
		</Box>
	);

	return (
		<Box className="flex-1">
			{layout}
			{searchOpen && <SearchOverlay />}
		</Box>
	);
}

export { BreadcrumbChip } from "./breadcrumb-chip";
