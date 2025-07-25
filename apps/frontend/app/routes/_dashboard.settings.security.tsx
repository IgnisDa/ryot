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
	PasswordInput,
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
	InitiateTwoFactorSetupDocument,
	type InitiateTwoFactorSetupMutation,
	UpdateUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getActionIntent, processSubmission } from "@ryot/ts-utils";
import { useMutation } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Form, data, useRevalidator } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	useConfirmSubmit,
	useCoreDetails,
	useDashboardLayoutData,
	useUserDetails,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/query-factory";
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
	password: z.string().optional(),
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
	const submit = useConfirmSubmit();
	const userDetails = useUserDetails();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;

	return (
		<Stack>
			<Form method="POST" action={withQuery(".", { intent: "updateProfile" })}>
				<input type="hidden" name="userId" defaultValue={userDetails.id} />
				<Stack>
					<TextInput
						readOnly
						defaultValue={userDetails.id}
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
					<PasswordInput
						name="password"
						label="Password"
						disabled={isEditDisabled || Boolean(userDetails.oidcIssuerId)}
						description={
							userDetails.oidcIssuerId
								? "Not applicable since this user was created via OIDC"
								: isEditDisabled
									? "Password can not be changed for the demo user"
									: undefined
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
								() => submit(form),
							);
						}}
					>
						Update
					</Button>
				</Stack>
			</Form>
		</Stack>
	);
};

const TwoFactorAuthSection = () => {
	const userDetails = useUserDetails();
	const coreDetails = useCoreDetails();
	const revalidator = useRevalidator();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;
	const [setupModalOpened, { open: openSetupModal, close: closeSetupModal }] =
		useDisclosure(false);

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
			revalidator.revalidate();
		},
	});

	const onCloseSetupModal = () => {
		closeSetupModal();
		revalidator.revalidate();
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
						<Group justify="space-between">
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
							<Button
								color="red"
								variant="light"
								disabled={isEditDisabled}
								onClick={() => {
									openConfirmationModal(
										"Are you sure you want to disable two-factor authentication? This will make your account less secure.",
										() => disableMutation.mutate(),
									);
								}}
							>
								Disable
							</Button>
						</Group>
					</Paper>
				</Stack>
			)}
		</Stack>
	);
};

interface TwoFactorSetupModalProps {
	opened: boolean;
	onClose: () => void;
}

const TwoFactorSetupModal = ({ opened, onClose }: TwoFactorSetupModalProps) => {
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
		onClose();
		setStep(TwoFactorSetupStep.Auth);
		setSetupData(null);
		setBackupCodes([]);
	};

	return (
		<Modal
			size="md"
			opened={opened}
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

const TwoFactorAuthStep = ({
	onNext,
	onClose,
	isLoading,
	error,
}: TwoFactorAuthStepProps) => {
	return (
		<Stack>
			<Alert>
				You are about to enable two-factor authentication for your account. This
				will require you to enter a code from your authenticator app each time
				you log in.
			</Alert>
			{error && (
				<Text c="red" size="sm">
					Failed to initiate two-factor setup. Please try again.
				</Text>
			)}
			<Group justify="flex-end">
				<Button variant="subtle" onClick={onClose} disabled={isLoading}>
					Cancel
				</Button>
				<Button onClick={onNext} loading={isLoading}>
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

const QRCodeStep = ({ onNext, onCancel, setupData }: QRCodeStepProps) => {
	if (!setupData) {
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
						value={setupData.qrCodeUrl}
					/>
				</Box>
				<Text size="xs" c="dimmed" ff="monospace">
					Secret: {setupData.secret}
				</Text>
			</Paper>
			<Text size="sm" c="dimmed">
				If you can't scan the QR code, you can manually enter the secret key
				shown above.
			</Text>
			<Group justify="space-between">
				<Button variant="subtle" color="red" onClick={onCancel}>
					Cancel
				</Button>
				<Button onClick={onNext}>Continue</Button>
			</Group>
		</Stack>
	);
};

interface VerifyCodeStepProps {
	onNext: () => void;
	onCancel: () => void;
	setBackupCodes: (codes: string[]) => void;
}

const VerifyCodeStep = ({
	onNext,
	onCancel,
	setBackupCodes,
}: VerifyCodeStepProps) => {
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
			setBackupCodes(data.backupCodes);
			onNext();
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
					onClick={onCancel}
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

interface BackupCodesStepProps {
	backupCodes: string[];
	onComplete: () => void;
}

const BackupCodesStep = ({ onComplete, backupCodes }: BackupCodesStepProps) => {
	return (
		<Stack>
			<Alert color="yellow">
				<Text fw="bold" mb="xs">
					Save these backup codes!
				</Text>
				<Text size="sm">
					These codes can be used to access your account if you lose your phone.
					Store them in a safe place - you won't be able to see them again.
				</Text>
			</Alert>
			<Paper withBorder p="md">
				<SimpleGrid cols={3}>
					{backupCodes.map((code) => (
						<Text key={code} ff="monospace" size="sm" ta="center">
							{code}
						</Text>
					))}
				</SimpleGrid>
			</Paper>
			<Group justify="flex-end">
				<Button onClick={onComplete}>I've Saved My Backup Codes</Button>
			</Group>
		</Stack>
	);
};
