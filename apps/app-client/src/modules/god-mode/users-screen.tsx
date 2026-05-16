import { View } from "react-native";

import { useGodModeSession } from "@/modules/god-mode/session";
import { GodModeUserTable } from "@/modules/god-mode/user-table";
import { AppSearchField } from "@/modules/ui/search-field";
import { SectionFrame } from "@/modules/ui/section-frame";
import { useDebouncedSearch } from "@/modules/ui/use-debounced-search";

export function GodModeUsersScreen() {
	const { lock } = useGodModeSession();
	const search = useDebouncedSearch();

	return (
		<SectionFrame
			title="Users"
			contentClassName="w-full max-w-6xl self-center"
			overflowItems={[{ label: "Lock god mode", onPress: () => lock(null) }]}
		>
			<View className="gap-5">
				<AppSearchField
					name="users by email"
					className="w-full md:w-80"
					search={{ ...search, isSearching: search.value.trim() !== search.query }}
				/>
				<GodModeUserTable key={search.query} search={search.query} />
			</View>
		</SectionFrame>
	);
}
