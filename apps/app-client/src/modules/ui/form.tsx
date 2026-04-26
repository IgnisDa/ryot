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

export function FormTextInput(props: ComponentProps<typeof TextInput> & { invalid?: boolean }) {
	const { invalid, ...inputProps } = props;
	return (
		<TextInput
			{...inputProps}
			aria-invalid={invalid}
			className={clsx(
				"rounded-lg border border-border bg-raised px-4 py-3 font-ui text-base text-text",
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
	onPress: () => void;
	pendingLabel?: string;
}) {
	const disabled = props.disabled || props.pending;
	return (
		<Pressable
			disabled={disabled}
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityState={{ disabled }}
			className={clsx("items-center rounded-lg bg-accent px-4 py-3", disabled && "opacity-50")}
		>
			<Text className="font-ui-semibold text-base text-accent-ink">
				{props.pending ? (props.pendingLabel ?? props.label) : props.label}
			</Text>
		</Pressable>
	);
}
