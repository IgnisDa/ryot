import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import QRCode from "react-native-qrcode-svg";

import { OtpInput } from "@/components/otp-input";
import { PageHeader } from "@/components/shell/page-header";
import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Input, InputField } from "@/components/ui/input";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useAuthClient } from "@/lib/atoms";

type SetupStep = "idle" | "scan" | "verify" | "newCodes";

export default function SettingsScreen() {
	const authClient = useAuthClient();
	const queryClient = useQueryClient();
	const { data: session, refetch: refetchSession } = authClient.useSession();

	const [password, setPassword] = useState("");
	const [otpResetKey, setOtpResetKey] = useState(0);
	const [step, setStep] = useState<SetupStep>("idle");
	const [totpUri, setTotpUri] = useState<string | null>(null);
	const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

	const twoFactorEnabled = session?.user.twoFactorEnabled ?? false;

	const accountsQuery = useQuery({
		enabled: !!session,
		queryKey: ["accounts"],
		queryFn: async () => {
			const { data, error } = await authClient.listAccounts();
			if (error) {
				throw new Error(error.message ?? "Could not load accounts");
			}
			return data;
		},
	});
	const canManageTwoFactor =
		accountsQuery.data?.some((a) => a.providerId === "credential") ?? false;

	const enableMutation = useMutation({
		mutationFn: async () => {
			const { data, error } = await authClient.twoFactor.enable({
				password: canManageTwoFactor ? password : undefined,
			});
			if (error) {
				throw new Error(error.message ?? "Could not start 2FA setup");
			}
			return data;
		},
		onSuccess: (data) => {
			setTotpUri(data.totpURI);
			setBackupCodes(data.backupCodes);
			setPassword("");
			setStep("scan");
		},
	});

	const verifyMutation = useMutation({
		onError: () => setOtpResetKey((k) => k + 1),
		mutationFn: async (code: string) => {
			const { error } = await authClient.twoFactor.verifyTotp({ code });
			if (error) {
				throw new Error(error.message ?? "Could not verify the code");
			}
		},
		onSuccess: async () => {
			await refetchSession();
			void queryClient.invalidateQueries();
			setStep("idle");
			setTotpUri(null);
			setBackupCodes(null);
		},
	});

	const disableMutation = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.twoFactor.disable({
				password: canManageTwoFactor ? password : undefined,
			});
			if (error) {
				throw new Error(error.message ?? "Could not disable 2FA");
			}
		},
		onSuccess: async () => {
			await refetchSession();
			void queryClient.invalidateQueries();
			setPassword("");
		},
	});

	const generateCodesMutation = useMutation({
		mutationFn: async () => {
			const { data, error } = await authClient.twoFactor.generateBackupCodes({
				password: canManageTwoFactor ? password : undefined,
			});
			if (error) {
				throw new Error(error.message ?? "Could not generate backup codes");
			}
			return data;
		},
		onSuccess: (data) => {
			setBackupCodes(data.backupCodes);
			setPassword("");
			setStep("newCodes");
		},
	});

	const anyPending =
		enableMutation.isPending || disableMutation.isPending || generateCodesMutation.isPending;

	if (canManageTwoFactor && step === "scan" && totpUri) {
		return (
			<PageHeader title="Set Up 2FA" eyebrow="Account">
				<Box className="mt-6 gap-6">
					<Box className="gap-2">
						<Text className="text-[15px] font-medium text-foreground">
							1. Scan with your authenticator app
						</Text>
						<Text className="text-[13px] leading-5 text-muted-foreground">
							Open your authenticator app (e.g. Google Authenticator) and scan the QR code below.
						</Text>
					</Box>
					<Box className="items-center py-4">
						<Box className="rounded-xl overflow-hidden p-3 bg-white">
							<QRCode value={totpUri} size={200} color="#000000" backgroundColor="#ffffff" />
						</Box>
					</Box>
					<Box className="gap-2">
						<Text className="text-[13px] text-muted-foreground">
							Can't scan? Enter this key manually:
						</Text>
						<Box className="rounded-lg border border-border bg-stone-50 px-4 py-3">
							<Text selectable className="text-[13px] font-mono text-foreground tracking-widest">
								{new URL(totpUri).searchParams.get("secret")}
							</Text>
						</Box>
					</Box>
					{backupCodes && backupCodes.length > 0 && (
						<Box className="gap-3">
							<Text className="text-[15px] font-medium text-foreground">
								2. Save your backup codes
							</Text>
							<Text className="text-[13px] leading-5 text-muted-foreground">
								Store these codes somewhere safe. Each code can only be used once to access your
								account if you lose your authenticator.
							</Text>
							<Box className="rounded-xl border border-border bg-stone-50 p-4 gap-2">
								<Box className="flex-row flex-wrap gap-x-6 gap-y-2">
									{backupCodes.map((code) => (
										<Text key={code} className="text-[13px] font-mono text-foreground">
											{code}
										</Text>
									))}
								</Box>
							</Box>
						</Box>
					)}
					<Button onPress={() => setStep("verify")}>
						<ButtonText>I've saved my backup codes, continue</ButtonText>
					</Button>
					<Pressable
						className="items-center"
						onPress={() => {
							setStep("idle");
							setTotpUri(null);
							setBackupCodes(null);
							enableMutation.reset();
						}}
					>
						<Text className="text-muted-foreground text-sm">Cancel</Text>
					</Pressable>
				</Box>
			</PageHeader>
		);
	}

	if (canManageTwoFactor && step === "verify") {
		return (
			<PageHeader title="Verify Setup" eyebrow="Account">
				<Box className="mt-6 gap-6">
					<Text className="text-[13px] leading-5 text-muted-foreground">
						Enter the 6-digit code from your authenticator app to confirm setup.
					</Text>
					<OtpInput
						key={otpResetKey}
						disabled={verifyMutation.isPending}
						onComplete={(code) => {
							if (!verifyMutation.isPending) {
								void verifyMutation.mutateAsync(code);
							}
						}}
					/>
					{verifyMutation.isPending && (
						<Box className="items-center">
							<Text className="text-muted-foreground text-sm">Verifying...</Text>
						</Box>
					)}
					{verifyMutation.error && (
						<Text className="text-destructive text-sm text-center">
							{verifyMutation.error.message}
						</Text>
					)}
					<Pressable
						disabled={verifyMutation.isPending}
						onPress={() => setStep("scan")}
						className={clsx("items-center", verifyMutation.isPending && "opacity-50")}
					>
						<Text className="text-muted-foreground text-sm">Back</Text>
					</Pressable>
				</Box>
			</PageHeader>
		);
	}

	if (canManageTwoFactor && step === "newCodes" && backupCodes) {
		return (
			<PageHeader title="New Backup Codes" eyebrow="Account">
				<Box className="mt-6 gap-4">
					<Text className="text-[13px] leading-5 text-muted-foreground">
						Your old backup codes have been replaced. Store these somewhere safe — each code can
						only be used once.
					</Text>
					<Box className="rounded-xl border border-border bg-stone-50 p-4 gap-2">
						<Box className="flex-row flex-wrap gap-x-6 gap-y-2">
							{backupCodes.map((code) => (
								<Text key={code} className="text-[13px] font-mono text-foreground">
									{code}
								</Text>
							))}
						</Box>
					</Box>
					<Button
						onPress={() => {
							setStep("idle");
							setBackupCodes(null);
						}}
					>
						<ButtonText>Done</ButtonText>
					</Button>
				</Box>
			</PageHeader>
		);
	}

	return (
		<PageHeader title="Settings" eyebrow="Account">
			<Box className="mt-6 gap-6">
				{canManageTwoFactor && (
					<>
						<Box className="gap-4">
							<Box className="gap-2">
								<Box className="flex-row items-center justify-between">
									<Text className="text-[17px] font-semibold text-foreground">
										Two-Factor Authentication
									</Text>
									{twoFactorEnabled && (
										<Box className="flex-row items-center gap-1">
											<Box className="w-2 h-2 rounded-full bg-green-500" />
											<Text className="text-[13px] text-muted-foreground">Enabled</Text>
										</Box>
									)}
								</Box>
								<Text className="text-[13px] leading-5 text-muted-foreground">
									{twoFactorEnabled
										? "Your account is protected with two-factor authentication."
										: "Add an extra layer of security to your account by requiring a verification code at sign-in."}
								</Text>
							</Box>
						</Box>
						<Box className="gap-1">
							<Text className="text-[13px] text-muted-foreground">Current password</Text>
							<Input>
								<InputField
									secureTextEntry
									value={password}
									returnKeyType="go"
									onChangeText={setPassword}
									autoComplete="current-password"
									placeholder="Required to make changes"
									onSubmitEditing={() => {
										if (twoFactorEnabled) {
											void disableMutation.mutateAsync();
										} else {
											void enableMutation.mutateAsync();
										}
									}}
								/>
							</Input>
						</Box>
						{twoFactorEnabled ? (
							<Box className="gap-3">
								<Button
									disabled={anyPending || !password.trim()}
									onPress={() => void generateCodesMutation.mutateAsync()}
								>
									{generateCodesMutation.isPending && <ButtonSpinner />}
									<ButtonText>
										{generateCodesMutation.isPending
											? "Generating..."
											: "Generate new backup codes"}
									</ButtonText>
								</Button>
								{generateCodesMutation.error && (
									<Text className="text-destructive text-sm">
										{generateCodesMutation.error.message}
									</Text>
								)}
								<Button
									disabled={anyPending || !password.trim()}
									onPress={() => void disableMutation.mutateAsync()}
								>
									{disableMutation.isPending && <ButtonSpinner />}
									<ButtonText>
										{disableMutation.isPending
											? "Disabling..."
											: "Disable two-factor authentication"}
									</ButtonText>
								</Button>
								{disableMutation.error && (
									<Text className="text-destructive text-sm">{disableMutation.error.message}</Text>
								)}
							</Box>
						) : (
							<Box className="gap-3">
								<Button
									onPress={() => void enableMutation.mutateAsync()}
									disabled={enableMutation.isPending || !password.trim()}
								>
									{enableMutation.isPending && <ButtonSpinner />}
									<ButtonText>
										{enableMutation.isPending
											? "Setting up..."
											: "Enable two-factor authentication"}
									</ButtonText>
								</Button>
								{enableMutation.error && (
									<Text className="text-destructive text-sm">{enableMutation.error.message}</Text>
								)}
							</Box>
						)}
					</>
				)}
			</Box>
		</PageHeader>
	);
}
