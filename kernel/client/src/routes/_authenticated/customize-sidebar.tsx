import { createFileRoute } from "@tanstack/react-router";

import { useCustomizeController } from "#/modules/navigation/authenticated-shell-context";
import { useIsDesktop } from "#/modules/navigation/breakpoint";
import { CustomizeScreen } from "#/modules/navigation/customize/customize-screen";
import { customizeSearchSection } from "#/modules/navigation/customize/customize-state";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export const Route = createFileRoute("/_authenticated/customize-sidebar")({
	component: CustomizeSidebarRoute,
	validateSearch: (search) => ({ section: customizeSearchSection(search) }),
});

// The panel itself is shell chrome: on desktop it takes over the sidebar rail, so this route's
// content region only dims. Below `md` the panel is the page, and the shell drops its own header.
function CustomizeSidebarRoute() {
	usePageTitle("Customize sidebar");
	const isDesktop = useIsDesktop();
	const { section } = Route.useSearch();
	const { onSave, onLeave, readOnly, customize } = useCustomizeController();

	return (
		<main {...mainContentProps} className="h-full min-h-0">
			{isDesktop ? (
				<div aria-hidden="true" className="h-full bg-overlay" />
			) : (
				<CustomizeScreen
					onSave={onSave}
					onLeave={onLeave}
					readOnly={readOnly}
					customize={customize}
					initialSection={section}
				/>
			)}
		</main>
	);
}
