import { useAtomValue, useSetAtom } from "jotai";
import type { ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { Box } from "@/components/ui/box";
import {
	navSheetOpenAtom,
	searchOpenAtom,
	subFlyoutOpenAtom,
	trackersAtom,
} from "@/lib/navigation";
import { SpineRail } from "./rail";
import { SearchOverlay } from "./search-overlay";
import { SpineSubFlyout } from "./sub-flyout";
import { TrackerSheet } from "./tracker-sheet";

const TABLET_BREAKPOINT = 768;

type Props = { children: ReactNode };

export function SpineNavigation({ children }: Props) {
	const { width: screenWidth } = useWindowDimensions();
	const trackers = useAtomValue(trackersAtom);
	const searchOpen = useAtomValue(searchOpenAtom);
	const navSheetOpen = useAtomValue(navSheetOpenAtom);
	const subFlyoutOpen = useAtomValue(subFlyoutOpenAtom);
	const setSubFlyoutOpen = useSetAtom(subFlyoutOpenAtom);

	const isTablet = screenWidth >= TABLET_BREAKPOINT;

	if (!trackers.length) {
		return <>{children}</>;
	}

	if (isTablet) {
		return (
			<Box className="flex-1 flex-row">
				<Box className="flex-1">{children}</Box>
				<SpineSubFlyout
					pinned
					open={subFlyoutOpen}
					onNavigate={() => setSubFlyoutOpen(false)}
				/>
				<SpineRail pinned onClose={() => {}} />
			</Box>
		);
	}

	return (
		<Box className="flex-1">
			{children}
			{searchOpen && <SearchOverlay />}
			{navSheetOpen && <TrackerSheet />}
		</Box>
	);
}

export { BreadcrumbChip } from "./breadcrumb-chip";
