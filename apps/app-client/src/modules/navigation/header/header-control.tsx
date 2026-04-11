import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

const HEADER_ICON_SIZE = 22;

const CONTROL_CLASS = "h-11 w-11 items-center justify-center rounded-pill";

export function HeaderLeadingControl(props: {
	label: string;
	onPress: () => void;
	icon: "menu" | "chevron-left";
}) {
	return (
		<Pressable
			onPress={props.onPress}
			className={CONTROL_CLASS}
			accessibilityRole="button"
			accessibilityLabel={props.label}
		>
			<AppIcon
				name={props.icon}
				className="text-text-muted"
				size={props.icon === "chevron-left" ? HEADER_ICON_SIZE + 4 : HEADER_ICON_SIZE}
			/>
		</Pressable>
	);
}

export function HeaderAction(props: {
	icon: string;
	label: string;
	badge?: number;
	disabled?: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			onPress={props.onPress}
			disabled={props.disabled}
			accessibilityRole="button"
			accessibilityLabel={props.label}
			className={clsx(CONTROL_CLASS, props.disabled && "opacity-40")}
		>
			<AppIcon name={props.icon} size={HEADER_ICON_SIZE} className="text-text-muted" />
			{props.badge === undefined ? null : (
				<View
					className={clsx(
						"absolute right-0.5 top-1 min-w-4 items-center rounded-pill px-1",
						props.badge > 0 ? "bg-accent" : "bg-surface-2",
					)}
				>
					<Text
						className={clsx(
							"font-mono text-[10px]",
							props.badge > 0 ? "text-accent-ink" : "text-text-subtle",
						)}
					>
						{props.badge}
					</Text>
				</View>
			)}
		</Pressable>
	);
}
