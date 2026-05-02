import { router } from "expo-router";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import Logo from "@/assets/icons/Logo";
import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Input, InputField } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { createApiClient } from "@/lib/api";
import { CLOUD_URL, serverUrlAtom } from "@/lib/atoms";

export default function Onboarding() {
	const [url, setUrl] = useState(CLOUD_URL);
	const [loading, setLoading] = useState(false);
	const setServerUrl = useSetAtom(serverUrlAtom);
	const [error, setError] = useState<string | null>(null);

	async function handleConnect() {
		const normalized = url.trim().replace(/\/$/, "");
		setError(null);

		try {
			new URL(normalized);
		} catch {
			setError("Please enter a valid URL");
			return;
		}

		setLoading(true);
		try {
			const { error: fetchError } =
				await createApiClient(normalized).GET("/system/health");
			if (fetchError) {
				setError("Could not reach the server");
				return;
			}
			setServerUrl(normalized);
			router.replace("/(app)");
		} catch {
			setError("Could not reach the server");
		} finally {
			setLoading(false);
		}
	}

	return (
		<KeyboardAvoidingView
			style={{ flex: 1 }}
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<Box className="flex-1 bg-background px-6 justify-center gap-8">
				<Box className="items-center gap-4">
					<Logo />
					<Text className="text-muted-foreground text-center">
						Connect to your Ryot instance
					</Text>
				</Box>
				<Box className="gap-3">
					<Input>
						<InputField
							value={url}
							keyboardType="url"
							autoCorrect={false}
							autoCapitalize="none"
							placeholder="https://app.ryot.io"
							onChangeText={(text) => {
								setUrl(text);
								setError(null);
							}}
						/>
					</Input>
					{error && <Text className="text-destructive text-sm">{error}</Text>}
					<Button disabled={loading} onPress={handleConnect}>
						{loading && <ButtonSpinner />}
						<ButtonText>{loading ? "Connecting..." : "Connect"}</ButtonText>
					</Button>
				</Box>
			</Box>
		</KeyboardAvoidingView>
	);
}
