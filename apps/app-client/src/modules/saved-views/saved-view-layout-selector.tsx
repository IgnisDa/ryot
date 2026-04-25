import { useAtomSet, useAtomValue } from "@effect/atom-react";
import clsx from "clsx";
import { Pressable, View } from "react-native";

import { savedViewLayoutAtom } from "@/api/atoms";
import { AppIcon } from "@/modules/icons";

const layouts = [
	{ icon: "grid", label: "Grid", value: "grid" },
	{ icon: "list", label: "List", value: "list" },
	{ icon: "table", label: "Table", value: "table" },
] as const;

export type SavedViewLayout = (typeof layouts)[number]["value"];

export function SavedViewLayoutSelector(props: { viewSlug: string }) {
	const layoutAtom = savedViewLayoutAtom(props.viewSlug);
	const layout = useAtomValue(layoutAtom);
	const setLayout = useAtomSet(layoutAtom);
	return (
		<View
			accessibilityRole="tablist"
			className="h-9 flex-row self-start rounded-pill border border-border-strong bg-surface-2 p-0.75 md:h-8.5 md:rounded-md"
		>
			{layouts.map((option) => {
				const selected = layout === option.value;
				return (
					<Pressable
						key={option.value}
						accessibilityRole="tab"
						accessibilityState={{ selected }}
						onPress={() => setLayout(option.value)}
						accessibilityLabel={`${option.label} view`}
						className={clsx(
							"h-7 w-9.5 items-center justify-center rounded-pill border border-transparent md:w-7.5 md:rounded-sm",
							"focus-visible:border-accent focus-visible:outline-none",
							selected && "bg-raised shadow-sm",
						)}
					>
						<AppIcon
							size={15}
							name={option.icon}
							className={clsx(selected ? "text-accent-text" : "text-text-muted")}
						/>
					</Pressable>
				);
			})}
		</View>
	);
}
