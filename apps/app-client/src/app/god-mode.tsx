import type { paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Share } from "react-native";

import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Input, InputField } from "@/components/ui/input";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { createApiClient } from "@/lib/api-client";
import { useServerUrl } from "@/lib/atoms";

type GodModeUser =
	paths["/god-mode/users"]["get"]["responses"][200]["content"]["application/json"]["data"]["users"][number];

const godModeUsersQueryKey = (token: string) => ["god-mode-users", token] as const;

export default function GodMode() {
	const serverUrl = useServerUrl();
	const [token, setToken] = useState("");
	const [submittedToken, setSubmittedToken] = useState<string | null>(null);

	if (!serverUrl) {
		return <Redirect href="/auth" />;
	}

	return (
		<KeyboardAvoidingView
			className="flex-1"
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<Box className="flex-1 bg-background">
				<Box className="flex-1 web:mx-auto web:w-full web:max-w-3xl">
					{submittedToken ? (
						<>
							<Box className="px-4 pt-16 pb-4 gap-2 web:pt-8">
								<Text className="text-foreground text-xl font-semibold">God Mode</Text>
								<Text className="text-muted-foreground text-sm">Server admin user management</Text>
							</Box>
							<UserList
								serverUrl={serverUrl}
								token={submittedToken}
								onReset={() => {
									setToken("");
									setSubmittedToken(null);
								}}
							/>
						</>
					) : (
						<TokenForm
							token={token}
							onTokenChange={setToken}
							onSubmit={() => setSubmittedToken(token)}
						/>
					)}
				</Box>
			</Box>
		</KeyboardAvoidingView>
	);
}

function TokenForm(props: {
	token: string;
	onSubmit: () => void;
	onTokenChange: (v: string) => void;
}) {
	const canSubmit = props.token.trim().length > 0;

	return (
		<Box className="flex-1 justify-center items-center px-6 gap-6">
			<Box className="w-full max-w-md gap-5">
				<Box className="gap-1">
					<Text className="text-foreground text-xl font-semibold">God Mode</Text>
					<Text className="text-muted-foreground text-sm">Server admin user management</Text>
				</Box>
				<Box className="gap-3">
					<Text className="text-muted-foreground text-sm">
						Enter your server admin access token to view and manage users.
					</Text>
					<Input>
						<InputField
							autoFocus
							returnKeyType="go"
							value={props.token}
							autoCorrect={false}
							autoCapitalize="none"
							placeholder="Admin access token"
							onChangeText={props.onTokenChange}
							onSubmitEditing={() => canSubmit && props.onSubmit()}
						/>
					</Input>
					<Button isDisabled={!canSubmit} onPress={props.onSubmit}>
						<ButtonText>Continue</ButtonText>
					</Button>
				</Box>
			</Box>
		</Box>
	);
}

function UserList(props: { token: string; serverUrl: string; onReset: () => void }) {
	const queryKey = godModeUsersQueryKey(props.token);
	const apiClient = createApiClient(props.serverUrl);

	const query = useQuery({
		queryKey,
		queryFn: async () => {
			const { data, error } = await apiClient.GET("/god-mode/users", {
				params: { query: { limit: 100 } },
				headers: { "Admin-Access-Token": props.token },
			});
			if (error) {
				throw new Error(error.error.message);
			}
			return data.data;
		},
	});

	if (query.isLoading) {
		return (
			<Box className="flex-1 justify-center items-center gap-2">
				<ActivityIndicator />
				<Text className="text-muted-foreground text-sm">Loading users...</Text>
			</Box>
		);
	}

	if (query.isError) {
		return (
			<Box className="flex-1 justify-center items-center px-6 gap-4">
				<Text className="text-destructive text-sm text-center">
					Failed to fetch users. Check your admin token.
				</Text>
				<Pressable onPress={props.onReset}>
					<Text className="text-muted-foreground text-sm">Try again</Text>
				</Pressable>
			</Box>
		);
	}

	const users = query.data;

	if (!users || users.users.length === 0) {
		return (
			<Box className="flex-1 justify-center items-center px-6">
				<Text className="text-muted-foreground text-sm">No users found</Text>
			</Box>
		);
	}

	return (
		<Box className="flex-1 px-4 gap-1">
			<Box className="flex-row px-3 py-2 border-b border-border gap-2">
				<Text className="flex-1 text-muted-foreground text-xs font-medium">Email</Text>
				<Text className="text-muted-foreground text-xs font-medium w-20 text-center">Status</Text>
				<Text className="text-muted-foreground text-xs font-medium w-20 text-center">Auth</Text>
			</Box>
			<FlatList
				data={users.users}
				keyExtractor={(item) => item.id}
				renderItem={({ item }) => (
					<UserRowWithReset user={item} token={props.token} apiClient={apiClient} />
				)}
			/>
		</Box>
	);
}

function UserRowWithReset(props: {
	token: string;
	user: GodModeUser;
	apiClient: ReturnType<typeof createApiClient>;
}) {
	const { user, token, apiClient } = props;
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [result, setResult] = useState<{ resetUrl: string; email: string } | null>(null);

	useEffect(() => {
		return () => {
			if (copyTimerRef.current) {
				clearTimeout(copyTimerRef.current);
			}
		};
	}, []);

	const resetMutation = useMutation({
		onSuccess: (data) => setResult(data),
		onError: (err) => setError(err.message),
		onMutate: () => {
			setError(null);
			setResult(null);
		},
		mutationFn: async () => {
			const { data, error: apiError } = await apiClient.POST(
				"/god-mode/users/{userId}/reset-password",
				{
					params: { path: { userId: user.id } },
					headers: { "Admin-Access-Token": token },
				},
			);
			if (apiError) {
				throw new Error(apiError.error.message);
			}
			return data.data;
		},
	});

	const setBanMutation = useMutation({
		onError: (err) => setError(err.message),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: godModeUsersQueryKey(token) });
		},
		onMutate: () => {
			setError(null);
			setResult(null);
		},
		mutationFn: async (banned: boolean) => {
			const { error: apiError } = await apiClient.POST("/god-mode/users/{userId}/ban/set", {
				body: { banned },
				params: { path: { userId: user.id } },
				headers: { "Admin-Access-Token": token },
			});
			if (apiError) {
				throw new Error(apiError.error.message);
			}
		},
	});

	const isDisabled = !!user.bannedAt;
	const canReset = user.authState === "credential" || user.authState === "none";

	async function handleCopy() {
		if (!result) {
			return;
		}
		const url = result.resetUrl;
		if (Platform.OS === "web") {
			try {
				await navigator.clipboard.writeText(url);
			} catch {
				return;
			}
		} else {
			void Share.share({ message: url });
		}
		setCopied(true);
		copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
	}

	return (
		<Box className="border-b border-border/50">
			<Box className="flex-row items-center px-3 py-3 gap-2">
				<Box className="flex-1 gap-0.5">
					<Text
						className={clsx(
							"text-sm",
							isDisabled ? "text-muted-foreground line-through" : "text-foreground",
						)}
					>
						{user.email}
					</Text>
					<Text className="text-muted-foreground text-xs">{user.name}</Text>
					{user.bannedAt && (
						<Text className="text-muted-foreground text-xs">
							Disabled since {dayjs(user.bannedAt).format("MMM D, YYYY")}
						</Text>
					)}
				</Box>
				<StatusBadge bannedAt={user.bannedAt} />
				<AuthBadge state={user.authState} />
			</Box>
			<Box className="flex-row flex-wrap items-center px-3 pb-3 gap-2">
				<Button
					size="sm"
					onPress={() => resetMutation.mutate()}
					isDisabled={!canReset || resetMutation.isPending}
				>
					{resetMutation.isPending && <ButtonSpinner />}
					<ButtonText>Generate reset link</ButtonText>
				</Button>
				<Button
					size="sm"
					isDisabled={setBanMutation.isPending}
					variant={isDisabled ? "outline" : "destructive"}
					onPress={() => setBanMutation.mutate(!isDisabled)}
				>
					{setBanMutation.isPending && <ButtonSpinner />}
					<ButtonText>{isDisabled ? "Enable user" : "Disable user"}</ButtonText>
				</Button>
				{!canReset && (
					<Text className="text-muted-foreground text-xs">
						{user.authState === "oidc" ? "OIDC-only user" : "Mixed auth — manual recovery needed"}
					</Text>
				)}
			</Box>
			{error && (
				<Box className="px-3 pb-3">
					<Text className="text-destructive text-xs">{error}</Text>
				</Box>
			)}
			{result && (
				<Box className="px-3 pb-3 gap-2">
					<Text className="text-foreground text-xs">Reset link for {result.email}</Text>
					<Box className="flex-row gap-2">
						<Input className="flex-1">
							<InputField editable={false} autoCorrect={false} value={result.resetUrl} />
						</Input>
						<Button size="sm" onPress={() => void handleCopy()} isDisabled={copied}>
							<ButtonText>{copied ? "Copied!" : "Copy"}</ButtonText>
						</Button>
					</Box>
				</Box>
			)}
		</Box>
	);
}

function StatusBadge(props: { bannedAt: string | null }) {
	const isDisabled = !!props.bannedAt;
	const color = isDisabled ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700";

	return (
		<Box className={clsx("rounded-full px-2.5 py-0.5 w-20 items-center", color)}>
			<Text className="text-xs font-medium">{isDisabled ? "Disabled" : "Enabled"}</Text>
		</Box>
	);
}

function AuthBadge(props: { state: GodModeUser["authState"] }) {
	const colors: Record<string, string> = {
		mixed: "bg-red-100 text-red-700",
		none: "bg-gray-100 text-gray-700",
		oidc: "bg-blue-100 text-blue-700",
		credential: "bg-green-100 text-green-700",
	};

	const labels: Record<string, string> = {
		none: "None",
		oidc: "OIDC",
		mixed: "Mixed",
		credential: "Password",
	};

	const label = labels[props.state] ?? props.state;
	const color = colors[props.state] ?? "bg-gray-100 text-gray-700";

	return (
		<Box className={clsx("rounded-full px-2.5 py-0.5 w-20 items-center", color)}>
			<Text className="text-xs font-medium">{label}</Text>
		</Box>
	);
}
