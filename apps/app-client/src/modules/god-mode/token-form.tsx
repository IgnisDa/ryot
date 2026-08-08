import { useForm } from "@tanstack/react-form";
import { Text, View } from "react-native";

import {
	FormCard,
	FormField,
	FormMessage,
	FormSubmitButton,
	FormTextInput,
	standardFormErrorVisibility,
} from "@/modules/ui/form";

export function TokenForm(props: {
	onEdit: () => void;
	error?: string | null;
	onSubmit: (token: string) => void;
}) {
	const form = useForm({
		defaultValues: { token: "" },
		errorVisibility: standardFormErrorVisibility,
		onSubmit: ({ value }) => props.onSubmit(value.token.trim()),
	});

	return (
		<FormCard>
			<View className="gap-2">
				<Text className="font-display-semibold text-3xl text-text">God Mode</Text>
				<Text className="font-ui text-sm text-text-muted">Server admin user management</Text>
			</View>
			<Text className="font-ui text-sm leading-5 text-text-muted">
				Enter your server admin access token to view and manage users.
			</Text>
			<form.Field
				name="token"
				validators={[
					{
						runOnMount: true,
						triggers: ["change", "blur"],
						run: ({ value }) =>
							value.trim() === "" ? "Enter your server admin access token." : undefined,
					},
				]}
			>
				{(field) => (
					<FormField label="Admin access token" error={field.errors[0]?.message}>
						<FormTextInput
							autoFocus
							secureTextEntry
							returnKeyType="go"
							value={field.value}
							autoCorrect={false}
							autoCapitalize="none"
							onBlur={field.handleBlur}
							invalid={field.meta.isInvalid}
							placeholder="Enter access token"
							accessibilityLabel="Admin access token"
							onSubmitEditing={() => void form.handleSubmit()}
							onChangeText={(token) => {
								field.handleChange(token);
								props.onEdit();
							}}
						/>
					</FormField>
				)}
			</form.Field>
			{props.error ? <FormMessage>{props.error}</FormMessage> : null}
			<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
				{([canSubmit, isSubmitting]) => (
					<FormSubmitButton
						label="Continue"
						disabled={!canSubmit}
						pending={isSubmitting}
						pendingLabel="Continuing..."
						onPress={() => void form.handleSubmit()}
					/>
				)}
			</form.Subscribe>
		</FormCard>
	);
}
