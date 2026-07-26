import { useAtomSet, useAtomValue } from "@effect/atom-react";
import clsx from "clsx";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";

import { connectToServerAtom } from "@/api/atoms";
import { getRedirectDestination } from "@/modules/navigation/redirect";
import { useSafeRedirectTo } from "@/modules/navigation/use-safe-redirect-to";
import { useSetServerUrl } from "@/modules/server/state";
import { resolveServerUrl } from "@/modules/server/url";

type ServerMode = "cloud" | "self-hosted";

const options = [
	{ mode: "cloud", label: "Ryot Cloud", subtitle: "The quickest way to start tracking" },
	{ mode: "self-hosted", label: "Self-hosted", subtitle: "Connect to your own Ryot instance" },
] as const;

export default function Onboarding() {
	const redirectTo = useSafeRedirectTo();
	const setServerUrl = useSetServerUrl();
	const resetConnect = useAtomSet(connectToServerAtom);
	const connectResult = useAtomValue(connectToServerAtom);
	const [mode, setMode] = useState<ServerMode>("cloud");
	const connect = useAtomSet(connectToServerAtom, { mode: "promise" });
	const [validationError, setValidationError] = useState<string | null>(null);
	const [url, setUrl] = useState(
		Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "",
	);

	const isPending = connectResult.waiting;
	const resolvedUrl = resolveServerUrl(mode, url);

	async function handleConnect() {
		setValidationError(null);
		if (mode === "self-hosted" && !URL.canParse(resolvedUrl)) {
			setValidationError("Enter a valid URL, including http:// or https://");
			return;
		}

		try {
			await connect(resolvedUrl);
			setServerUrl(resolvedUrl);
			router.replace(getRedirectDestination(redirectTo, "/auth"));
		} catch {}
	}

	return (
		<KeyboardAvoidingView
			className="flex-1 bg-bg"
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<View className="flex-1 items-center justify-center px-6 py-10">
				<View className="w-full max-w-md gap-8">
					<View className="gap-2">
						<Text className="font-display-semibold text-4xl text-text">
							Your Ryot, your server.
						</Text>
						<Text className="font-ui text-base leading-6 text-text-muted">
							Choose where your library lives. You can change this later.
						</Text>
					</View>

					<View className="gap-3">
						{options.map((option) => {
							const selected = mode === option.mode;
							return (
								<Pressable
									key={option.mode}
									accessibilityRole="radio"
									accessibilityState={{ checked: selected }}
									className={clsx(
										"gap-1 rounded-lg border bg-surface p-4",
										selected ? "border-accent" : "border-border",
									)}
									onPress={() => {
										setMode(option.mode);
										setValidationError(null);
										resetConnect(Atom.Reset);
									}}
								>
									<Text
										className={clsx(
											"font-ui-medium text-base",
											selected ? "text-accent-text" : "text-text",
										)}
									>
										{option.label}
									</Text>
									<Text className="font-ui text-sm text-text-muted">{option.subtitle}</Text>
								</Pressable>
							);
						})}

						{mode === "self-hosted" && (
							<TextInput
								value={url}
								keyboardType="url"
								returnKeyType="go"
								autoCorrect={false}
								autoCapitalize="none"
								accessibilityLabel="Server URL"
								placeholder="https://app.ryot.io"
								onSubmitEditing={() => void handleConnect()}
								className="rounded-lg border border-border bg-raised px-4 py-3 font-ui text-base text-text placeholder:text-text-subtle"
								onChangeText={(value) => {
									setUrl(value);
									setValidationError(null);
									resetConnect(Atom.Reset);
								}}
							/>
						)}

						{validationError && (
							<Text className="font-ui text-sm text-danger">{validationError}</Text>
						)}
						{AsyncResult.isFailure(connectResult) && (
							<Text className="font-ui text-sm text-danger">
								Could not reach that Ryot server. Check the address and try again.
							</Text>
						)}

						<Pressable
							accessibilityRole="button"
							onPress={() => void handleConnect()}
							disabled={isPending || (mode === "self-hosted" && !url.trim())}
							className={clsx(
								"items-center rounded-lg bg-accent px-4 py-3",
								(isPending || (mode === "self-hosted" && !url.trim())) && "opacity-50",
							)}
						>
							<Text className="font-ui-semibold text-base text-accent-ink">
								{isPending ? "Checking server..." : "Continue"}
							</Text>
						</Pressable>
					</View>
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}
