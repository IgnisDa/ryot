import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Input, InputField } from "@/components/ui/input";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { createApiClient } from "@/lib/api";
import { CLOUD_URL, useSetServerUrl } from "@/lib/atoms";

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
	const setServerUrl = useSetServerUrl();
	const [mode, setMode] = useState<ServerMode>("cloud");
	const [url, setUrl] = useState(
		Platform.OS === "web" ? window.location.origin : "",
	);

	const resolvedUrl =
		mode === "cloud" ? CLOUD_URL : url.trim().replace(/\/$/, "");

	const connectMutation = useMutation({
		mutationFn: async (targetUrl: string) => {
			if (mode === "self-hosted") {
				try {
					new URL(targetUrl);
				} catch {
					throw new Error("Please enter a valid URL");
				}
			}
			const { error } = await createApiClient(targetUrl).GET("/system/health");
			if (error) {
				throw new Error("Could not reach the server");
			}
			return targetUrl;
		},
		onSuccess: (targetUrl) => {
			setServerUrl(targetUrl);
			router.replace("/auth");
		},
	});

	const isDisabled =
		connectMutation.isPending || (mode === "self-hosted" && !url.trim());

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
										connectMutation.reset();
									}}
									className={clsx(
										"rounded-lg border p-4 gap-1",
										selected
											? "border-primary bg-primary/5"
											: "border-border bg-transparent",
									)}
								>
									<Text
										className={clsx(
											"font-medium text-sm",
											selected ? "text-primary" : "text-foreground",
										)}
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
									onSubmitEditing={() => connectMutation.mutate(resolvedUrl)}
									onChangeText={(text) => {
										setUrl(text);
										connectMutation.reset();
									}}
								/>
							</Input>
						)}
						{connectMutation.error && (
							<Text className="text-destructive text-sm">
								{connectMutation.error.message}
							</Text>
						)}
						<Button
							isDisabled={isDisabled}
							onPress={() => connectMutation.mutate(resolvedUrl)}
						>
							{connectMutation.isPending && <ButtonSpinner />}
							<ButtonText>
								{connectMutation.isPending ? "Connecting..." : "Continue"}
							</ButtonText>
						</Button>
					</Box>
				</Box>
			</Box>
		</KeyboardAvoidingView>
	);
}
