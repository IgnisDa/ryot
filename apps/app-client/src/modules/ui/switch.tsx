import clsx from "clsx";
import { Pressable, View } from "react-native";

export function AppSwitch(props: {
	readonly label: string;
	readonly checked: boolean;
	readonly onChange: (value: boolean) => void;
}) {
	return (
		<Pressable
			accessibilityRole="switch"
			accessibilityLabel={props.label}
			accessibilityState={{ checked: props.checked }}
			onPress={() => props.onChange(!props.checked)}
			className={clsx(
				"h-6 w-10 justify-center rounded-pill border border-border p-0.5",
				props.checked && "bg-accent",
				!props.checked && "bg-surface-2",
			)}
		>
			<View className={clsx("h-5 w-5 rounded-pill bg-raised", props.checked && "self-end")} />
		</Pressable>
	);
}
