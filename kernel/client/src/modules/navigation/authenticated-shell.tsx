import { Outlet } from "@tanstack/react-router";

import { DesktopSidebar } from "#/modules/navigation/desktop-sidebar";

export function AuthenticatedShell(props: { readonly initialRememberedSlug: string | null }) {
	return (
		<div data-testid="authenticated-shell" className="flex h-dvh min-h-0 flex-col md:flex-row">
			<DesktopSidebar initialRememberedSlug={props.initialRememberedSlug} />
			<header data-testid="mobile-header" aria-hidden="true" className="h-16 shrink-0 md:hidden" />
			<aside data-testid="mobile-drawer" aria-hidden="true" inert className="hidden" />
			<div data-testid="shell-content" className="min-h-0 min-w-0 flex-1 overflow-hidden">
				<Outlet />
			</div>
		</div>
	);
}
