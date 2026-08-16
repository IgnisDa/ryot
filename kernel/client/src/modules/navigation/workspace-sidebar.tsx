import type { CustomizeSection } from "./customize/customize-state";
import type { NavigationItem } from "./navigation-data";
import { Sidebar } from "./sidebar";
import type { ReadyWorkspaceNavigation } from "./use-workspace-navigation";

export function WorkspaceSidebar(props: {
	readonly className: string;
	readonly onOpenSearch?: () => void;
	readonly onOpenSettings: () => void;
	readonly onWorkspaceOpen: () => void;
	readonly navigation: ReadyWorkspaceNavigation;
	readonly onNavigate: (item: NavigationItem) => void;
	readonly onEditSection?: (section: CustomizeSection) => void;
}) {
	return (
		<Sidebar
			className={props.className}
			onNavigate={props.onNavigate}
			isPro={props.navigation.isPro}
			items={props.navigation.items}
			onOpenSearch={props.onOpenSearch}
			onEditSection={props.onEditSection}
			onOpenSettings={props.onOpenSettings}
			key={props.navigation.workspace.slug}
			activeKey={props.navigation.activeKey}
			workspace={props.navigation.workspace}
			onWorkspaceOpen={props.onWorkspaceOpen}
			accountName={props.navigation.accountName}
			accountEmail={props.navigation.accountEmail}
			accountImage={props.navigation.accountImage}
		/>
	);
}
