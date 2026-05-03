import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

const SHOW_TABS = [
	{ key: "overview", label: "Overview", onSelect: () => undefined },
	{ key: "episodes", label: "Episodes", onSelect: () => console.log("TODO: open episodes tab") },
	{ key: "activity", label: "Activity", onSelect: () => console.log("TODO: open activity tab") },
	{ key: "related", label: "Related", onSelect: () => console.log("TODO: open related tab") },
] as const;

export type ShowTabKey = (typeof SHOW_TABS)[number]["key"];

export function ShowTabBar(props: { readonly activeTab: ShowTabKey }) {
	return (
		<View
			accessibilityRole="tablist"
			className="flex-row border-b border-border md:justify-start md:gap-2"
		>
			{SHOW_TABS.map((tab) => {
				const isActive = tab.key === props.activeTab;
				return (
					<Pressable
						key={tab.key}
						onPress={tab.onSelect}
						accessibilityRole="tab"
						accessibilityState={{ selected: isActive }}
						className={clsx(
							"flex-1 items-center border-b-2 px-3 pb-2.5 pt-3 md:flex-none",
							isActive ? "border-accent" : "border-transparent",
						)}
					>
						<Text
							className={clsx(
								"font-ui-medium text-[14px]",
								isActive ? "text-accent-text" : "text-text-muted",
							)}
						>
							{tab.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
