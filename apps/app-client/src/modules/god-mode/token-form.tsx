import clsx from "clsx";
import { Pressable, Text, TextInput, View } from "react-native";

export function TokenForm(props: {
	token: string;
	onSubmit: () => void;
	onTokenChange: (value: string) => void;
}) {
	const canSubmit = props.token.trim().length > 0;

	function handleSubmit() {
		if (canSubmit) {
			props.onSubmit();
		}
	}

	return (
		<View className="w-full max-w-md gap-5 rounded-xl border border-border bg-surface p-6 shadow-card">
			<View className="gap-2">
				<Text className="font-display-semibold text-3xl text-text">God Mode</Text>
				<Text className="font-ui text-sm text-text-muted">Server admin user management</Text>
			</View>
			<Text className="font-ui text-sm leading-5 text-text-muted">
				Enter your server admin access token to view and manage users.
			</Text>
			<TextInput
				autoFocus
				returnKeyType="go"
				autoCorrect={false}
				value={props.token}
				autoCapitalize="none"
				onSubmitEditing={handleSubmit}
				placeholder="Admin access token"
				onChangeText={props.onTokenChange}
				accessibilityLabel="Admin access token"
				className="rounded-lg border border-border bg-raised px-4 py-3 font-ui text-base text-text"
			/>
			<Pressable
				disabled={!canSubmit}
				onPress={handleSubmit}
				accessibilityRole="button"
				className={clsx("items-center rounded-lg bg-accent px-4 py-3", !canSubmit && "opacity-50")}
			>
				<Text className="font-ui-semibold text-base text-accent-ink">Continue</Text>
			</Pressable>
		</View>
	);
}
