import {
	Alert,
	Box,
	Button,
	Container,
	Group,
	Modal,
	Paper,
	PasswordInput,
	PinInput,
	Stack,
	Tabs,
	Text,
	TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { UpdateUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { getActionIntent, processSubmission } from "@ryot/ts-utils";
import { useState } from "react";
import { Form } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	useConfirmSubmit,
	useDashboardLayoutData,
	useUserDetails,
} from "~/lib/shared/hooks";
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
			return Response.json({ status: "success", submission } as const, {
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
			<Tabs defaultValue="password">
				<Tabs.List>
					<Tabs.Tab value="password">Password</Tabs.Tab>
					<Tabs.Tab value="2fa">Two-Factor Authentication</Tabs.Tab>
				</Tabs.List>
				<Box mt="md">
					<Tabs.Panel value="password">
						<PasswordSection />
					</Tabs.Panel>
					<Tabs.Panel value="2fa">
						<TwoFactorAuthSection />
					</Tabs.Panel>
				</Box>
			</Tabs>
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
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;
	const [setupModalOpened, { open: openSetupModal, close: closeSetupModal }] =
		useDisclosure(false);

	return (
		<Stack>
			{!userDetails.twoFactorBackupCodes ? (
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
							onClose={closeSetupModal}
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
							</Box>
							<Button
								color="red"
								variant="light"
								disabled={isEditDisabled}
								onClick={() => {
									// TODO: Implement disable 2FA modal
									console.log("Disable 2FA clicked");
								}}
							>
								Disable
							</Button>
						</Group>
					</Paper>
					<Paper withBorder p="md">
						<Stack>
							<Text fw="bold">Backup Codes</Text>
							<Text size="sm" c="dimmed">
								Generate new backup codes to use when you don't have access to
								your authenticator app.
							</Text>
							<Button
								variant="light"
								disabled={isEditDisabled}
								onClick={() => {
									// TODO: Implement generate backup codes modal
									console.log("Generate backup codes clicked");
								}}
							>
								Generate New Backup Codes
							</Button>
						</Stack>
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

	return (
		<Modal
			size="md"
			opened={opened}
			onClose={onClose}
			title="Enable Two-Factor Authentication"
		>
			{step === TwoFactorSetupStep.Auth && (
				<TwoFactorAuthStep
					onClose={onClose}
					onNext={() => setStep(TwoFactorSetupStep.QRCode)}
				/>
			)}
			{step === TwoFactorSetupStep.QRCode && (
				<QRCodeStep
					onBack={() => setStep(TwoFactorSetupStep.Auth)}
					onNext={() => setStep(TwoFactorSetupStep.Verify)}
				/>
			)}
			{step === TwoFactorSetupStep.Verify && (
				<VerifyCodeStep
					onBack={() => setStep(TwoFactorSetupStep.QRCode)}
					onNext={() => setStep(TwoFactorSetupStep.BackupCodes)}
				/>
			)}
			{step === TwoFactorSetupStep.BackupCodes && (
				<BackupCodesStep onComplete={onClose} />
			)}
		</Modal>
	);
};

interface TwoFactorAuthStepProps {
	onNext: () => void;
	onClose: () => void;
}

const TwoFactorAuthStep = ({ onNext, onClose }: TwoFactorAuthStepProps) => {
	return (
		<Stack>
			<Alert>
				You are about to enable two-factor authentication for your account. This
				will require you to enter a code from your authenticator app each time
				you log in.
			</Alert>
			<Group justify="flex-end">
				<Button variant="subtle" onClick={onClose}>
					Cancel
				</Button>
				<Button onClick={onNext}>Continue</Button>
			</Group>
		</Stack>
	);
};

interface QRCodeStepProps {
	onNext: () => void;
	onBack: () => void;
}

const QRCodeStep = ({ onNext, onBack }: QRCodeStepProps) => {
	return (
		<Stack>
			<Text>
				Scan the QR code below with your authenticator app (such as Google
				Authenticator or 1Password).
			</Text>
			<Paper withBorder p="md" ta="center">
				<Text size="sm" c="dimmed" mb="md">
					QR Code will be displayed here
				</Text>
				<Text size="xs" c="dimmed">
					Secret: PLACEHOLDER_SECRET_KEY
				</Text>
			</Paper>
			<Text size="sm" c="dimmed">
				If you can't scan the QR code, you can manually enter the secret key
				shown above.
			</Text>
			<Group justify="space-between">
				<Button variant="subtle" onClick={onBack}>
					Back
				</Button>
				<Button onClick={onNext}>I've Added the Account</Button>
			</Group>
		</Stack>
	);
};

interface VerifyCodeStepProps {
	onNext: () => void;
	onBack: () => void;
}

const VerifyCodeStep = ({ onNext, onBack }: VerifyCodeStepProps) => {
	const [code, setCode] = useState("");

	return (
		<Stack>
			<Text>
				Enter the 6-digit code from your authenticator app to verify the setup.
			</Text>
			<PinInput value={code} length={6} onChange={setCode} />
			<Group justify="space-between">
				<Button variant="subtle" onClick={onBack}>
					Back
				</Button>
				<Button onClick={onNext} disabled={code.length !== 6}>
					Verify & Enable
				</Button>
			</Group>
		</Stack>
	);
};

interface BackupCodesStepProps {
	onComplete: () => void;
}

const BackupCodesStep = ({ onComplete }: BackupCodesStepProps) => {
	const userDetails = useUserDetails();
	const backupCodes = userDetails.twoFactorBackupCodes || [];

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
				<Stack gap="xs">
					{backupCodes.map((backupCode) => (
						<Text key={backupCode.code} ff="monospace" size="sm">
							{backupCode.code}
						</Text>
					))}
				</Stack>
			</Paper>
			<Group justify="flex-end">
				<Button onClick={onComplete}>I've Saved My Backup Codes</Button>
			</Group>
		</Stack>
	);
};
