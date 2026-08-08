import { useForm } from "@tanstack/react-form";
import clsx from "clsx";
import { useRef, useState } from "react";
import type { TextInput } from "react-native";
import { Pressable, Text, View } from "react-native";

import {
	FormField,
	FormMessage,
	FormSubmitButton,
	FormTextInput,
	standardFormErrorVisibility,
} from "@/modules/ui/form";

export type AuthMode = "login" | "signup";
export type CredentialsValues = { email: string; password: string };

const content = {
	login: {
		action: "Sign in",
		title: "Welcome back",
		pending: "Signing in...",
		subtitle: "Pick up where you left off.",
	},
	signup: {
		title: "Make it yours",
		action: "Create account",
		pending: "Creating account...",
		subtitle: "Start a library shaped around you.",
	},
} as const;

export function CredentialsForm(props: {
	mode: AuthMode;
	disabled?: boolean;
	defaultValues?: CredentialsValues;
	signupAllowed: boolean;
	onModeChange: (mode: AuthMode) => void;
	onSubmit: (values: CredentialsValues) => Promise<string | undefined>;
}) {
	const passwordRef = useRef<TextInput>(null);
	const [serverError, setServerError] = useState<string>();
	const modeContent = content[props.mode];
	const form = useForm({
		defaultValues: props.defaultValues ?? { email: "", password: "" },
		errorVisibility: standardFormErrorVisibility,
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			setServerError(
				await props.onSubmit({ password: value.password, email: value.email.trim().toLowerCase() }),
			);
		},
	});

	function changeMode(mode: AuthMode) {
		form.reset({ email: form.state.values.email, password: "" });
		setServerError(undefined);
		props.onModeChange(mode);
	}

	return (
		<>
			<View className="gap-2">
				<Text className="font-display-semibold text-3xl text-text">{modeContent.title}</Text>
				<Text className="font-ui text-base text-text-muted">{modeContent.subtitle}</Text>
			</View>
			<View className="gap-4">
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) =>
						props.signupAllowed ? (
							<View className="flex-row rounded-lg bg-surface-2 p-1">
								{(["login", "signup"] as const).map((option) => (
									<Pressable
										key={option}
										accessibilityRole="tab"
										onPress={() => changeMode(option)}
										disabled={(props.disabled ?? false) || isSubmitting}
										accessibilityState={{ selected: props.mode === option }}
										className={clsx(
											"flex-1 items-center rounded-md py-2",
											props.mode === option && "bg-raised shadow-sm",
										)}
									>
										<Text
											className={clsx(
												"font-ui-medium text-sm",
												props.mode === option ? "text-text" : "text-text-muted",
											)}
										>
											{option === "login" ? "Sign in" : "Sign up"}
										</Text>
									</Pressable>
								))}
							</View>
						) : null
					}
				</form.Subscribe>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<>
							<form.Field
								name="email"
								validators={[
									{
										runOnMount: true,
										triggers: ["change", "blur"],
										run: ({ value }) =>
											value.trim().includes("@") ? undefined : "Enter a valid email address.",
									},
								]}
							>
								{(field) => (
									<FormField label="Email address" error={field.errors[0]?.message}>
										<FormTextInput
											value={field.value}
											autoCorrect={false}
											returnKeyType="next"
											autoComplete="email"
											autoCapitalize="none"
											onBlur={field.handleBlur}
											keyboardType="email-address"
											placeholder="you@example.com"
											invalid={field.errors.length > 0}
											accessibilityLabel="Email address"
											editable={!props.disabled && !isSubmitting}
											onSubmitEditing={() => passwordRef.current?.focus()}
											onChangeText={(email) => {
												field.handleChange(email);
												setServerError(undefined);
											}}
										/>
									</FormField>
								)}
							</form.Field>
							<form.Field
								name="password"
								validators={[
									{
										runOnMount: true,
										triggers: ["change", "blur"],
										run: ({ value }) =>
											value.length >= 8 ? undefined : "Password must be at least 8 characters.",
									},
								]}
							>
								{(field) => (
									<FormField label="Password" error={field.errors[0]?.message}>
										<FormTextInput
											secureTextEntry
											returnKeyType="go"
											value={field.value}
											inputRef={passwordRef}
											placeholder="Password"
											onBlur={field.handleBlur}
											accessibilityLabel="Password"
											invalid={field.errors.length > 0}
											editable={!props.disabled && !isSubmitting}
											onSubmitEditing={() => void form.handleSubmit()}
											autoComplete={props.mode === "login" ? "current-password" : "new-password"}
											onChangeText={(password) => {
												field.handleChange(password);
												setServerError(undefined);
											}}
										/>
									</FormField>
								)}
							</form.Field>
						</>
					)}
				</form.Subscribe>
				{serverError === undefined ? null : <FormMessage>{serverError}</FormMessage>}
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
					{([canSubmit, isSubmitting]) => (
						<FormSubmitButton
							pending={isSubmitting}
							label={modeContent.action}
							pendingLabel={modeContent.pending}
							onPress={() => void form.handleSubmit()}
							disabled={(props.disabled ?? false) || !canSubmit}
						/>
					)}
				</form.Subscribe>
			</View>
		</>
	);
}
