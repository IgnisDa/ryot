import {
	Alert,
	Box,
	Button,
	Center,
	Container,
	Divider,
	Group,
	Modal,
	Paper,
	PinInput,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CompleteTwoFactorSetupDocument,
	DisableTwoFactorDocument,
	GetPasswordChangeSessionDocument,
	InitiateTwoFactorSetupDocument,
	type InitiateTwoFactorSetupMutation,
	RegenerateTwoFactorBackupCodesDocument,
	UpdateUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getActionIntent, processSubmission } from "@ryot/ts-utils";
import { useMutation } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Form, data, useNavigate } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { CopyableTextInput } from "~/components/common";
import { redirectToQueryParam } from "~/lib/shared/constants";
import {
	useConfirmSubmit,
	useCoreDetails,
	useDashboardLayoutData,
	useInvalidateUserDetails,
	useUserDetails,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.security";

enum TwoFactorSetupStep {
	Auth = "auth",
	QRCode = "qr_code",
	Verify = "verify",
	BackupCodes = "backup_codes",
}

export const meta = () => {
	return [{ title: "Security | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("updateProfile", async () => {
			const submission = processSubmission(formData, updateProfileFormSchema);
			await serverGqlService.authenticatedRequest(request, UpdateUserDocument, {
				input: submission,
			});
			return data({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Profile updated successfully",
				}),
			});
		})
		.run();
};

const updateProfileFormSchema = z.object({
	userId: z.string(),
	email: z.email().optional(),
	username: z.string().optional(),
});

export default function Page() {
	return (
		<Container size="xs">
			<Stack gap="xl">
				<PasswordSection />
				<Divider />
				<TwoFactorAuthSection />
			</Stack>
		</Container>
	);
}

const PasswordSection = () => {
	const navigate = useNavigate();
	const submit = useConfirmSubmit();
	const userDetails = useUserDetails();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;
	const invalidateUserDetails = useInvalidateUserDetails();

	const generatePasswordChangeSessionMutation = useMutation({
		mutationFn: async () => {
			const { getPasswordChangeSession } = await clientGqlService.request(
				GetPasswordChangeSessionDocument,
				{ input: { userId: userDetails.id } },
			);
			return getPasswordChangeSession.passwordChangeUrl;
		},
		onSuccess: (url) => {
			if (!url) return;
			notifications.show({
				color: "green",
				title: "Success",
				message: "You will be logged out and redirected to set a new password",
			});

			navigate(
				withQuery($path("/api/logout"), { [redirectToQueryParam]: url }),
			);
		},
		onError: () => {
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to generate password change session",
			});
		},
	});

	return (
		<Stack>
			<Form method="POST" action={withQuery(".", { intent: "updateProfile" })}>
				<input type="hidden" name="userId" defaultValue={userDetails.id} />
				<Stack>
					<CopyableTextInput
						value={userDetails.id}
						description="Database generated user ID"
					/>
					<TextInput
						name="username"
						label="Username"
						disabled={isEditDisabled}
						defaultValue={userDetails.name}
						description={
							isEditDisabled && "Username can not be changed for the demo user"
						}
					/>
					<Button
						fullWidth
						type="submit"
						onClick={(e) => {
							const form = e.currentTarget.form;
							e.preventDefault();
							openConfirmationModal(
								"Are you sure you want to update your profile?",
								async () => {
									submit(form);
									await invalidateUserDetails();
								},
							);
						}}
					>
						Update Profile
					</Button>
				</Stack>
			</Form>

			<Divider />

			{userDetails.oidcIssuerId ? (
				<Alert color="blue" title="OIDC User">
					Password change is not available since this user was created via OIDC.
				</Alert>
			) : (
				<Button
					fullWidth
					color="orange"
					variant="light"
					disabled={isEditDisabled}
					loading={generatePasswordChangeSessionMutation.isPending}
					onClick={() => {
						openConfirmationModal(
							"Are you sure you want to change your password? You will be logged out and redirected to set a new password.",
							() => generatePasswordChangeSessionMutation.mutate(),
						);
					}}
				>
					Change Password
				</Button>
			)}
		</Stack>
	);
};

const TwoFactorAuthSection = () => {
	const userDetails = useUserDetails();
	const coreDetails = useCoreDetails();
	const navigate = useNavigate();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;
	const [setupModalOpened, { open: openSetupModal, close: closeSetupModal }] =
		useDisclosure(false);
	const [regeneratedBackupCodes, setRegeneratedBackupCodes] = useState<
		string[]
	>([]);

	const disableMutation = useMutation({
		mutationFn: async () => {
			const { disableTwoFactor } = await clientGqlService.request(
				DisableTwoFactorDocument,
				{},
			);
			return disableTwoFactor;
		},
		onSuccess: () => {
			notifications.show({
				color: "yellow",
				message: "Two-Factor Authentication Disabled",
			});
			navigate($path("/api/logout"));
		},
	});

	const regenerateBackupCodesMutation = useMutation({
		mutationFn: async () => {
			const { regenerateTwoFactorBackupCodes } = await clientGqlService.request(
				RegenerateTwoFactorBackupCodesDocument,
				{},
			);
			return regenerateTwoFactorBackupCodes;
		},
		onSuccess: (data) => {
			notifications.show({
				color: "green",
				message: "Backup codes regenerated successfully",
			});
			setRegeneratedBackupCodes(data.backupCodes);
		},
	});

	const onCloseSetupModal = () => {
		closeSetupModal();
	};

	return (
		<Stack>
			{userDetails.timesTwoFactorBackupCodesUsed === null ? (
				<Paper withBorder p="md">
					<Stack>
						<Text size="lg" fw="bold">
							Two-Factor Authentication
						</Text>
						<Text size="sm" c="dimmed">
							Add an extra layer of security by requiring a code from your phone
							in addition to your password.
						</Text>
						<Button onClick={openSetupModal} disabled={isEditDisabled}>
							Enable Two-Factor Authentication
						</Button>
						{isEditDisabled && (
							<Text size="xs" c="dimmed">
								Two-factor authentication can not be enabled for the demo user
							</Text>
						)}
						<TwoFactorSetupModal
							opened={setupModalOpened}
							onClose={onCloseSetupModal}
						/>
					</Stack>
				</Paper>
			) : (
				<Stack>
					<Paper withBorder p="md">
						<Stack>
							<Box>
								<Text size="lg" fw="bold">
									Two-Factor Authentication
								</Text>
								<Text size="sm" c="dimmed">
									Two-factor authentication is active on your account
								</Text>
								{userDetails.timesTwoFactorBackupCodesUsed !== null && (
									<Text size="xs" c="dimmed" mt="xs">
										Backup codes used:{" "}
										{userDetails.timesTwoFactorBackupCodesUsed} /{" "}
										{coreDetails.twoFactorBackupCodesCount}
									</Text>
								)}
							</Box>
							<Group wrap="nowrap">
								<Button
									fullWidth
									color="red"
									variant="light"
									disabled={isEditDisabled}
									onClick={() => {
										openConfirmationModal(
											"Are you sure you want to disable two-factor authentication? This will make your account less secure and you will be logged out.",
											() => disableMutation.mutate(),
										);
									}}
								>
									Disable
								</Button>
								<Button
									fullWidth
									variant="outline"
									disabled={isEditDisabled}
									loading={regenerateBackupCodesMutation.isPending}
									onClick={() => {
										openConfirmationModal(
											"Are you sure you want to regenerate your backup codes? Your current backup codes will become invalid.",
											() => regenerateBackupCodesMutation.mutate(),
										);
									}}
								>
									Regenerate Backup Codes
								</Button>
							</Group>
						</Stack>
					</Paper>
				</Stack>
			)}
			<Modal
				size="md"
				title="New Backup Codes Generated"
				opened={regeneratedBackupCodes.length > 0}
				onClose={() => setRegeneratedBackupCodes([])}
			>
				<BackupCodesDisplay
					title="Save your new backup codes!"
					backupCodes={regeneratedBackupCodes}
					completeButtonText="I've Saved My New Backup Codes"
					onComplete={() => setRegeneratedBackupCodes([])}
					description="Your previous backup codes are no longer valid. Save these new codes in a safe place - you won't be able to see them again."
				/>
			</Modal>
		</Stack>
	);
};

interface TwoFactorSetupModalProps {
	opened: boolean;
	onClose: () => void;
}

const TwoFactorSetupModal = (props: TwoFactorSetupModalProps) => {
	const [step, setStep] = useState(TwoFactorSetupStep.Auth);
	const [setupData, setSetupData] = useState<{
		secret: string;
		qrCodeUrl: string;
	} | null>(null);
	const [backupCodes, setBackupCodes] = useState<string[]>([]);

	const initiateMutation = useMutation({
		mutationFn: async () => {
			const { initiateTwoFactorSetup } = await clientGqlService.request(
				InitiateTwoFactorSetupDocument,
				{},
			);
			return initiateTwoFactorSetup;
		},
		onSuccess: (data) => {
			setSetupData(data);
			setStep(TwoFactorSetupStep.QRCode);
		},
	});

	const onCloseSetupModal = () => {
		props.onClose();
		setStep(TwoFactorSetupStep.Auth);
		setSetupData(null);
		setBackupCodes([]);
	};

	return (
		<Modal
			size="md"
			opened={props.opened}
			onClose={onCloseSetupModal}
			title="Enable Two-Factor Authentication"
		>
			{step === TwoFactorSetupStep.Auth && (
				<TwoFactorAuthStep
					onClose={onCloseSetupModal}
					error={initiateMutation.isError}
					onNext={initiateMutation.mutate}
					isLoading={initiateMutation.isPending}
				/>
			)}
			{step === TwoFactorSetupStep.QRCode && (
				<QRCodeStep
					onCancel={onCloseSetupModal}
					setupData={setupData}
					onNext={() => setStep(TwoFactorSetupStep.Verify)}
				/>
			)}
			{step === TwoFactorSetupStep.Verify && (
				<VerifyCodeStep
					onCancel={onCloseSetupModal}
					setBackupCodes={setBackupCodes}
					onNext={() => setStep(TwoFactorSetupStep.BackupCodes)}
				/>
			)}
			{step === TwoFactorSetupStep.BackupCodes && (
				<BackupCodesStep
					onComplete={onCloseSetupModal}
					backupCodes={backupCodes}
				/>
			)}
		</Modal>
	);
};

interface TwoFactorAuthStepProps {
	error: boolean;
	onNext: () => void;
	isLoading: boolean;
	onClose: () => void;
}

const TwoFactorAuthStep = (props: TwoFactorAuthStepProps) => {
	return (
		<Stack>
			<Alert>
				You are about to enable two-factor authentication for your account. This
				will require you to enter a code from your authenticator app each time
				you log in. You will be logged out after enabling 2FA.
			</Alert>
			{props.error && (
				<Text c="red" size="sm">
					Failed to initiate two-factor setup. Please try again.
				</Text>
			)}
			<Group justify="flex-end">
				<Button
					variant="subtle"
					onClick={props.onClose}
					disabled={props.isLoading}
				>
					Cancel
				</Button>
				<Button onClick={props.onNext} loading={props.isLoading}>
					Continue
				</Button>
			</Group>
		</Stack>
	);
};

interface QRCodeStepProps {
	onNext: () => void;
	onCancel: () => void;
	setupData: InitiateTwoFactorSetupMutation["initiateTwoFactorSetup"] | null;
}

const QRCodeStep = (props: QRCodeStepProps) => {
	if (!props.setupData) {
		return (
			<Stack>
				<Text>Loading setup data...</Text>
			</Stack>
		);
	}

	return (
		<Stack>
			<Text>
				Scan the QR code below with your authenticator app (such as Google
				Authenticator or 1Password).
			</Text>
			<Paper withBorder p="md" ta="center">
				<Box mb="md">
					<QRCodeSVG
						level="M"
						size={200}
						marginSize={1}
						value={props.setupData.qrCodeUrl}
					/>
				</Box>
				<Text size="xs" c="dimmed" ff="monospace">
					Secret: {props.setupData.secret}
				</Text>
			</Paper>
			<Text size="sm" c="dimmed">
				If you can't scan the QR code, you can manually enter the secret key
				shown above.
			</Text>
			<Group justify="space-between">
				<Button variant="subtle" color="red" onClick={props.onCancel}>
					Cancel
				</Button>
				<Button onClick={props.onNext}>Continue</Button>
			</Group>
		</Stack>
	);
};

interface VerifyCodeStepProps {
	onNext: () => void;
	onCancel: () => void;
	setBackupCodes: (codes: string[]) => void;
}

const VerifyCodeStep = (props: VerifyCodeStepProps) => {
	const [code, setCode] = useState("");

	const completeMutation = useMutation({
		mutationFn: async () => {
			const { completeTwoFactorSetup } = await clientGqlService.request(
				CompleteTwoFactorSetupDocument,
				{ input: { totpCode: code } },
			);
			return completeTwoFactorSetup;
		},
		onSuccess: (data) => {
			props.setBackupCodes(data.backupCodes);
			props.onNext();
		},
	});

	const handleVerify = () => {
		if (code.length === 6) {
			completeMutation.mutate();
		}
	};

	return (
		<Stack>
			<Text>
				Enter the 6-digit code from your authenticator app to verify the setup.
			</Text>
			<Center>
				<PinInput value={code} length={6} onChange={setCode} />
			</Center>
			{completeMutation.isError && (
				<Text c="red" size="sm">
					Invalid code. Please try again.
				</Text>
			)}
			<Group justify="space-between">
				<Button
					color="red"
					variant="subtle"
					onClick={props.onCancel}
					disabled={completeMutation.isPending}
				>
					Cancel
				</Button>
				<Button
					onClick={handleVerify}
					disabled={code.length !== 6}
					loading={completeMutation.isPending}
				>
					Verify & Enable
				</Button>
			</Group>
		</Stack>
	);
};

interface BackupCodesDisplayProps {
	title?: string;
	description?: string;
	backupCodes: string[];
	onComplete?: () => void;
	completeButtonText?: string;
}

const BackupCodesDisplay = (props: BackupCodesDisplayProps) => {
	return (
		<Stack>
			<Alert color="yellow">
				<Text fw="bold" mb="xs">
					{props.title || "Save your backup codes!"}
				</Text>
				<Text size="sm">
					{props.description ||
						"These codes can be used to access your account if you lose your phone. Store them in a safe place - you won't be able to see them again."}
				</Text>
			</Alert>
			<Paper withBorder p="md">
				<SimpleGrid cols={3}>
					{props.backupCodes.map((code) => (
						<Text key={code} ff="monospace" size="sm" ta="center">
							{code}
						</Text>
					))}
				</SimpleGrid>
			</Paper>
			{props.onComplete && (
				<Group justify="flex-end">
					<Button onClick={props.onComplete}>
						{props.completeButtonText || "I've Saved My Backup Codes"}
					</Button>
				</Group>
			)}
		</Stack>
	);
};

interface BackupCodesStepProps {
	backupCodes: string[];
	onComplete: () => void;
}

const BackupCodesStep = (props: BackupCodesStepProps) => {
	const navigate = useNavigate();

	const handleComplete = () => {
		props.onComplete();
		navigate($path("/api/logout"));
	};

	return (
		<BackupCodesDisplay
			onComplete={handleComplete}
			backupCodes={props.backupCodes}
		/>
	);
};
