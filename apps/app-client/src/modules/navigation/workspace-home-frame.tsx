import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { HeaderAction, HeaderLeadingControl } from "./header/header-control";
import { HeaderFrame } from "./header/header-frame";
import { HeaderSearchRow } from "./header/header-search-row";
import { useWorkspaceDrawer } from "./workspace-drawer";

export function WorkspaceHomeFrame(props: { children: ReactNode }) {
	const drawer = useWorkspaceDrawer();
	const [searchValue, setSearchValue] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const workspaceName = drawer.navigation.workspace.name;

	function exitSearch() {
		setSearchValue("");
		setIsSearchOpen(false);
	}

	return (
		<HeaderFrame
			title={workspaceName}
			onSearchEdgeSwipe={exitSearch}
			leading={
				<HeaderLeadingControl icon="menu" label="Open navigation" onPress={drawer.openDrawer} />
			}
			searchRow={
				isSearchOpen ? (
					<HeaderSearchRow
						value={searchValue}
						onExit={exitSearch}
						onChange={setSearchValue}
						onSubmit={() => undefined}
						label={`Search ${workspaceName}...`}
						onClear={() => setSearchValue("")}
					/>
				) : undefined
			}
			actions={
				<HeaderAction
					icon="search"
					label={`Search ${workspaceName}`}
					onPress={() => setIsSearchOpen(true)}
				/>
			}
		>
			{isSearchOpen ? (
				<View className="min-h-96 items-center justify-center gap-2 px-6">
					<Text className="font-ui-semibold text-lg text-text">Workspace search</Text>
					<Text className="max-w-sm text-center font-ui text-sm text-text-muted">
						Workspace search is not available yet.
					</Text>
				</View>
			) : (
				props.children
			)}
		</HeaderFrame>
	);
}
