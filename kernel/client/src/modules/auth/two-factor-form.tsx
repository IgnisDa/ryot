import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { Pressable, Text } from "react-native";

import {
	FormCard,
	FormField,
	FormMessage,
	FormSubmitButton,
	FormTextInput,
	standardFormErrorVisibility,
} from "@/modules/ui/form";

export type TwoFactorMethod = "totp" | "backupCode";

export function TwoFactorForm(props: {
	onBack: () => void;
	method: TwoFactorMethod;
	onMethodChange: (method: TwoFactorMethod) => void;
	onSubmit: (code: string) => Promise<string | undefined>;
}) {
	const usingBackupCode = props.method === "backupCode";
	const [serverError, setServerError] = useState<string>();
	const form = useForm({
		defaultValues: { code: "" },
		errorVisibility: standardFormErrorVisibility,
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			const error = await props.onSubmit(value.code.trim());
			setServerError(error);
			if (error !== undefined) {
				form.reset();
			}
		},
	});

	function changeMethod() {
		form.reset();
		setServerError(undefined);
		props.onMethodChange(usingBackupCode ? "totp" : "backupCode");
	}

	return (
		<FormCard>
			<Text className="font-display-semibold text-2xl text-text">One more step</Text>
			<Text className="font-ui text-sm leading-5 text-text-muted">
				{usingBackupCode
					? "Enter one of your saved backup codes."
					: "Enter the 6-digit code from your authenticator app."}
			</Text>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<form.Field
						name="code"
						validators={[
							{
								runOnMount: true,
								triggers: ["change", "blur"],
								run: ({ value }) =>
									value.trim() === "" ? "Enter your two-factor authentication code." : undefined,
							},
						]}
					>
						{(field) => (
							<FormField
								error={field.errors[0]?.message}
								label={usingBackupCode ? "Backup code" : "Authenticator code"}
							>
								<FormTextInput
									autoFocus
									returnKeyType="go"
									autoCorrect={false}
									value={field.value}
									autoCapitalize="none"
									editable={!isSubmitting}
									onBlur={field.handleBlur}
									invalid={field.errors.length > 0}
									maxLength={usingBackupCode ? undefined : 6}
									onSubmitEditing={() => void form.handleSubmit()}
									placeholder={usingBackupCode ? "Backup code" : "000000"}
									keyboardType={usingBackupCode ? "default" : "number-pad"}
									accessibilityLabel={usingBackupCode ? "Backup code" : "Authenticator code"}
									onChangeText={(code) => {
										field.handleChange(code);
										setServerError(undefined);
									}}
								/>
							</FormField>
						)}
					</form.Field>
				)}
			</form.Subscribe>
			{serverError === undefined ? null : <FormMessage>{serverError}</FormMessage>}
			<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
				{([canSubmit, isSubmitting]) => (
					<>
						<FormSubmitButton
							label="Verify"
							disabled={!canSubmit}
							pending={isSubmitting}
							pendingLabel="Verifying..."
							onPress={() => void form.handleSubmit()}
						/>
						<Pressable disabled={isSubmitting} accessibilityRole="button" onPress={changeMethod}>
							<Text className="text-center font-ui-medium text-sm text-text-muted">
								{usingBackupCode ? "Use an authenticator code" : "Use a backup code"}
							</Text>
						</Pressable>
						<Pressable disabled={isSubmitting} accessibilityRole="button" onPress={props.onBack}>
							<Text className="text-center font-ui-medium text-sm text-text-muted">
								Back to sign in
							</Text>
						</Pressable>
					</>
				)}
			</form.Subscribe>
		</FormCard>
	);
}
