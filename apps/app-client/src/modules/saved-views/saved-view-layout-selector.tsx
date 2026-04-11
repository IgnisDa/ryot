import { useAtomSet, useAtomValue } from "@effect/atom-react";
import clsx from "clsx";
import { Pressable, View } from "react-native";

import { useApiScope } from "@/api/scope";
import { AppIcon } from "@/modules/icons";

import { savedViewLayoutAtom } from "./atoms";

const layouts = [
	{ icon: "grid", label: "Grid", value: "grid" },
	{ icon: "list", label: "List", value: "list" },
	{ icon: "table", label: "Table", value: "table" },
] as const;

export type SavedViewLayout = (typeof layouts)[number]["value"];

export const useSavedViewLayout = (viewSlug: string) => {
	const scope = useApiScope();
	const layoutAtom = savedViewLayoutAtom({ ...scope, viewSlug });
	const layout = useAtomValue(layoutAtom);
	const setLayout = useAtomSet(layoutAtom);
	return [layout, setLayout] as const;
};

export function SavedViewLayoutSelector(props: {
	value: SavedViewLayout;
	onChange: (layout: SavedViewLayout) => void;
}) {
	return (
		<View
			accessibilityRole="radiogroup"
			className="h-9 flex-row items-center self-start rounded-pill bg-surface-2 p-0.75 md:h-8.5 md:items-stretch md:rounded-md md:border md:border-border-strong"
		>
			{layouts.map((option) => {
				const selected = props.value === option.value;
				return (
					<Pressable
						key={option.value}
						accessibilityRole="radio"
						onPress={() => props.onChange(option.value)}
						accessibilityState={{ checked: selected }}
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
							className={clsx(selected && "text-accent-text", !selected && "text-text-muted")}
						/>
					</Pressable>
				);
			})}
		</View>
	);
}
