import clsx from "clsx";
import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export function FormCard(props: PropsWithChildren) {
	return (
		<View className="w-full max-w-md gap-6 rounded-xl border border-border bg-surface p-6 shadow-card">
			{props.children}
		</View>
	);
}

export function FormField(props: PropsWithChildren<{ error?: string; label: string }>) {
	return (
		<View className="gap-1.5">
			<Text className="font-ui-medium text-xs text-text-muted">{props.label}</Text>
			{props.children}
			{props.error === undefined ? null : <FormMessage>{props.error}</FormMessage>}
		</View>
	);
}

export function FormMessage(props: { children: ReactNode }) {
	return (
		<Text accessibilityRole="alert" className="font-ui text-sm text-danger">
			{props.children}
		</Text>
	);
}

export function FormTextInput(
	props: ComponentProps<typeof TextInput> & { density?: "compact" | "default"; invalid?: boolean },
) {
	const { density = "default", invalid, ...inputProps } = props;
	return (
		<TextInput
			{...inputProps}
			aria-invalid={invalid}
			className={clsx(
				"rounded-lg border border-border bg-raised font-ui text-text",
				density === "default" ? "px-4 py-3 text-base" : "h-10 px-3 text-sm",
				invalid && "border-danger",
				props.className,
			)}
		/>
	);
}

export function FormSubmitButton(props: {
	label: string;
	pending?: boolean;
	disabled?: boolean;
	className?: string;
	onPress: () => void;
	pendingLabel?: string;
	density?: "compact" | "default";
}) {
	const disabled = props.disabled || props.pending;
	const density = props.density ?? "default";
	return (
		<Pressable
			disabled={disabled}
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityState={{ disabled }}
			className={clsx(
				"items-center justify-center rounded-lg bg-accent px-4",
				density === "default" ? "py-3" : "h-10",
				disabled && "opacity-50",
				props.className,
			)}
		>
			<Text
				className={clsx(
					"font-ui-semibold text-accent-ink",
					density === "default" ? "text-base" : "text-sm",
				)}
			>
				{props.pending ? (props.pendingLabel ?? props.label) : props.label}
			</Text>
		</Pressable>
	);
}
