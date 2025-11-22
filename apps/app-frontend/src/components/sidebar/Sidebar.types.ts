import type { AppFacet } from "#/features/facets/model";
import type { AppSavedView } from "#/features/saved-views/model";
import type { AuthenticatedUser } from "#/hooks/auth";

export type SidebarAccount = Pick<
	AuthenticatedUser["user"],
	"id" | "name" | "email" | "image" | "createdAt" | "updatedAt"
>;

export type SidebarView = Pick<
	AppSavedView,
	"id" | "icon" | "name" | "facetId" | "accentColor"
> & {
	facetSlug: string | null;
};

export type SidebarFacet = Pick<
	AppFacet,
	| "id"
	| "icon"
	| "slug"
	| "name"
	| "enabled"
	| "sortOrder"
	| "isBuiltin"
	| "accentColor"
> & {
	isExpanded?: boolean;
	views?: SidebarView[];
};

export interface SidebarProps {
	drawerOpened: boolean;
	onOpenDrawer: () => void;
	onCloseDrawer: () => void;
}
