import type { AppSavedView } from "#/features/saved-views/model";
import type { AppTracker } from "#/features/trackers/model";
import type { AuthenticatedUser } from "#/hooks/auth";

export type SidebarAccount = Pick<
	AuthenticatedUser["user"],
	"id" | "name" | "email" | "image" | "createdAt" | "updatedAt"
>;

export type SidebarView = Pick<
	AppSavedView,
	"id" | "icon" | "name" | "trackerId" | "accentColor"
> & {
	trackerSlug: string | null;
};

export type SidebarTracker = Pick<
	AppTracker,
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
