import { createErrorVisibility } from "@tanstack/react-form";
import clsx from "clsx";
import type { ComponentProps, PropsWithChildren, ReactNode, Ref } from "react";
import { Text, TextInput, View } from "react-native";

import { AppButton } from "./button";

export const standardFormErrorVisibility = createErrorVisibility(
	({ fieldState, state }) => fieldState.meta.isBlurred || state.submissionAttempts > 0,
);

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
	props: ComponentProps<typeof TextInput> & {
		invalid?: boolean;
		inputRef?: Ref<TextInput>;
		density?: "compact" | "default";
	},
) {
	const { density = "default", inputRef, invalid, ...inputProps } = props;
	return (
		<TextInput
			{...inputProps}
			ref={inputRef}
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
	const density = props.density ?? "default";
	return (
		<AppButton
			variant="primary"
			label={props.label}
			onPress={props.onPress}
			pending={props.pending}
			disabled={props.disabled}
			className={props.className}
			pendingLabel={props.pendingLabel}
			size={density === "default" ? "default" : "compact"}
		/>
	);
}
