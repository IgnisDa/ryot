import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

export type AppSegment<Value extends string = string> = {
	readonly value: Value;
	readonly label: string;
};

export function AppSegmentedControl<Value extends string>(props: {
	readonly label: string;
	readonly stretch?: boolean;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly role?: "radio" | "tab";
	readonly value: Value | undefined;
	readonly onChange: (value: Value) => void;
	readonly segments: readonly AppSegment<Value>[];
}) {
	const role = props.role ?? "radio";
	const stretch = props.stretch ?? false;
	const disabled = props.disabled ?? false;
	return (
		<View
			accessibilityLabel={props.label}
			accessibilityRole={role === "tab" ? "tablist" : "radiogroup"}
			className={clsx(
				"flex-row rounded-lg bg-surface-2 p-1",
				stretch ? "w-full" : "self-start",
				disabled && "opacity-50",
				props.className,
			)}
		>
			{props.segments.map((segment) => {
				const selected = segment.value === props.value;
				return (
					<Pressable
						disabled={disabled}
						key={segment.value}
						accessibilityRole={role}
						accessibilityLabel={segment.label}
						onPress={() => props.onChange(segment.value)}
						accessibilityState={
							role === "tab" ? { disabled, selected } : { disabled, checked: selected }
						}
						className={clsx(
							"items-center justify-center rounded-md border border-transparent",
							"focus-visible:border-accent focus-visible:outline-none",
							stretch ? "min-h-9 flex-1" : "min-h-8 px-3",
							selected && "bg-raised shadow-sm",
						)}
					>
						<Text
							className={clsx(
								"font-ui-medium",
								stretch ? "text-sm" : "text-xs",
								selected ? "text-text" : "text-text-muted",
							)}
						>
							{segment.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
