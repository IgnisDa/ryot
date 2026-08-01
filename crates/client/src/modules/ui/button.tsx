import clsx from "clsx";
import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";

export function AppButton(props: {
	readonly label: string;
	readonly pending?: boolean;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly leading?: ReactNode;
	readonly onPress: () => void;
	readonly pendingLabel?: string;
	readonly accessibilityLabel?: string;
	readonly size?: "compact" | "default";
	readonly variant?: "primary" | "outline";
}) {
	const size = props.size ?? "compact";
	const variant = props.variant ?? "outline";
	const disabled = (props.disabled ?? false) || (props.pending ?? false);
	const displayedLabel = props.pending ? (props.pendingLabel ?? props.label) : props.label;
	return (
		<Pressable
			disabled={disabled}
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityState={{ disabled }}
			accessibilityLabel={props.accessibilityLabel ?? displayedLabel}
			className={clsx(
				"flex-row items-center justify-center gap-2 rounded-lg px-4",
				size === "compact" ? "h-10" : "py-3",
				variant === "primary" ? "bg-accent" : "border border-border-strong",
				disabled && "opacity-50",
				props.className,
			)}
		>
			{props.leading}
			<Text
				className={clsx(
					variant === "primary" ? "font-ui-semibold text-accent-ink" : "font-ui-medium text-text",
					size === "compact" ? "text-sm" : "text-base",
				)}
			>
				{displayedLabel}
			</Text>
		</Pressable>
	);
}
