import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

export type ShowTabKey = "overview" | "episodes";

type ShowTab =
	| { readonly label: string; readonly key: ShowTabKey }
	| { readonly key: string; readonly label: string; readonly todo: string };

const SHOW_TABS: readonly ShowTab[] = [
	{ key: "overview", label: "Overview" },
	{ key: "episodes", label: "Episodes" },
	{ key: "activity", label: "Activity", todo: "TODO: open activity tab" },
	{ key: "related", label: "Related", todo: "TODO: open related tab" },
];

export function ShowTabBar(props: {
	readonly activeTab: ShowTabKey;
	readonly onSelect: (tab: ShowTabKey) => void;
}) {
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
						accessibilityRole="tab"
						accessibilityState={{ selected: isActive }}
						onPress={() => ("todo" in tab ? console.log(tab.todo) : props.onSelect(tab.key))}
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
