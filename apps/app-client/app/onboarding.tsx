import { router } from "expo-router";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Input, InputField } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { createApiClient } from "@/lib/api";
import { CLOUD_URL, serverUrlAtom } from "@/lib/atoms";

type ServerMode = "cloud" | "self-hosted";

const options: { mode: ServerMode; label: string; subtitle: string }[] = [
	{
		mode: "cloud",
		label: "Ryot Cloud",
		subtitle: "Managed by Ryot at app.ryot.io",
	},
	{
		mode: "self-hosted",
		label: "Self-hosted",
		subtitle: "Connect to your own instance",
	},
];

export default function Onboarding() {
	const [url, setUrl] = useState("");
	const setServerUrl = useSetAtom(serverUrlAtom);
	const [loading, setLoading] = useState(false);
	const [mode, setMode] = useState<ServerMode>("cloud");
	const [error, setError] = useState<string | null>(null);

	const resolvedUrl =
		mode === "cloud" ? CLOUD_URL : url.trim().replace(/\/$/, "");

	async function handleConnect() {
		setError(null);

		if (mode === "self-hosted") {
			try {
				new URL(resolvedUrl);
			} catch {
				setError("Please enter a valid URL");
				return;
			}
		}

		setLoading(true);
		try {
			const { error: fetchError } =
				await createApiClient(resolvedUrl).GET("/system/health");
			if (fetchError) {
				setError("Could not reach the server");
				return;
			}
			setServerUrl(resolvedUrl);
			router.replace("/auth");
		} catch {
			setError("Could not reach the server");
		} finally {
			setLoading(false);
		}
	}

	const isDisabled = loading || (mode === "self-hosted" && !url.trim());

	return (
		<KeyboardAvoidingView
			style={{ flex: 1 }}
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<Box className="flex-1 bg-background justify-center items-center">
				<Box className="w-full max-w-md px-6 gap-8">
					<Box className="items-center gap-4">
						<Text className="text-muted-foreground text-center">
							Connect to your Ryot instance
						</Text>
					</Box>
					<Box className="gap-3">
						{options.map((opt) => {
							const selected = mode === opt.mode;
							return (
								<Pressable
									key={opt.mode}
									onPress={() => {
										setMode(opt.mode);
										setError(null);
									}}
									className={
										selected
											? "rounded-lg border border-primary bg-primary/5 p-4 gap-1"
											: "rounded-lg border border-border bg-transparent p-4 gap-1"
									}
								>
									<Text
										className={
											selected
												? "font-medium text-sm text-primary"
												: "font-medium text-sm text-foreground"
										}
									>
										{opt.label}
									</Text>
									<Text className="text-muted-foreground text-xs">
										{opt.subtitle}
									</Text>
								</Pressable>
							);
						})}
						{mode === "self-hosted" && (
							<Input>
								<InputField
									value={url}
									keyboardType="url"
									returnKeyType="go"
									autoCorrect={false}
									autoCapitalize="none"
									placeholder="https://ryot.yourdomain.com"
									onSubmitEditing={() => void handleConnect()}
									onChangeText={(text) => {
										setUrl(text);
										setError(null);
									}}
								/>
							</Input>
						)}
						{error && <Text className="text-destructive text-sm">{error}</Text>}
						<Button disabled={isDisabled} onPress={handleConnect}>
							{loading && <ButtonSpinner />}
							<ButtonText>{loading ? "Connecting..." : "Continue"}</ButtonText>
						</Button>
					</Box>
				</Box>
			</Box>
		</KeyboardAvoidingView>
	);
}
