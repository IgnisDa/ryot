import clsx from "clsx";
import { Pressable, Text } from "react-native";

export function AppChip(props: {
	readonly label: string;
	readonly checked: boolean;
	readonly className?: string;
	readonly onPress: () => void;
	readonly role: "radio" | "checkbox";
}) {
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole={props.role}
			accessibilityLabel={props.label}
			accessibilityState={{ checked: props.checked }}
			className={clsx(
				"h-7 items-center justify-center rounded-pill border px-3",
				props.checked ? "border-accent-border bg-accent-soft" : "border-border-strong",
				props.className,
			)}
		>
			<Text
				className={clsx(
					"font-ui-medium text-xs",
					props.checked ? "text-accent-text" : "text-text-muted",
				)}
			>
				{props.label}
			</Text>
		</Pressable>
	);
}
