import type { AuthenticatedUser } from "#/hooks/auth";

export type SidebarAccount = Pick<
	AuthenticatedUser["user"],
	"id" | "name" | "email" | "image" | "createdAt" | "updatedAt"
>;

export interface SidebarFacet {
	id: string;
	icon: string;
	slug: string;
	name: string;
	enabled: boolean;
	sortOrder: number;
	isBuiltin: boolean;
	accentColor: string;
	isExpanded?: boolean;
	views?: SidebarView[];
}

export interface SidebarView {
	id: string;
	icon: string;
	name: string;
	accentColor: string;
	facetId: string | null;
	facetSlug: string | null;
}

export interface SidebarProps {
	drawerOpened: boolean;
	onOpenDrawer: () => void;
	onCloseDrawer: () => void;
}
