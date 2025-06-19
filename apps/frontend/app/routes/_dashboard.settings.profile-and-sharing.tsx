import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Box,
	Button,
	Checkbox,
	Container,
	Divider,
	Flex,
	Group,
	Indicator,
	Modal,
	NumberInput,
	Paper,
	PasswordInput,
	Skeleton,
	Stack,
	Tabs,
	Text,
	TextInput,
	ThemeIcon,
	Title,
	Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import {
	CreateAccessLinkDocument,
	RevokeAccessLinkDocument,
	UpdateUserDocument,
	UserAccessLinksDocument,
	type UserAccessLinksQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	formatQuantityWithCompactNotation,
	getActionIntent,
	isNumber,
	isString,
	processSubmission,
	zodCheckboxAsString,
	zodIntAsString,
} from "@ryot/ts-utils";
import {
	IconEye,
	IconEyeClosed,
	IconLock,
	IconLockAccess,
} from "@tabler/icons-react";
import Cookies from "js-cookie";
import { Form, useLoaderData, useNavigate } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	applicationBaseUrl,
	dayjsLib,
	openConfirmationModal,
} from "~/lib/common";
import {
	useConfirmSubmit,
	useCoreDetails,
	useDashboardLayoutData,
	useIsMobile,
	useIsOnboardingTourCompleted,
	useUserDetails,
} from "~/lib/hooks";
import { useOnboardingTour } from "~/lib/state/general";
import {
	createToastHeaders,
	getDecodedJwt,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.profile-and-sharing";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const decodedJwt = getDecodedJwt(request);
	const [{ userAccessLinks }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UserAccessLinksDocument, {}),
	]);
	return { userAccessLinks, activeAccessLinkId: decodedJwt?.access_link_id };
};

export const meta = () => {
	return [{ title: "Profile and Sharing | Ryot" }];
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
		.with("revokeAccessLink", async () => {
			const submission = processSubmission(
				formData,
				revokeAccessLinkFormSchema,
			);
			await serverGqlService.authenticatedRequest(
				request,
				RevokeAccessLinkDocument,
				submission,
			);
			return Response.json({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Access link revoked successfully",
				}),
			});
		})
		.with("createAccessLink", async () => {
			const submission = processSubmission(
				formData,
				createAccessLinkFormSchema,
			);
			submission.expiresOn = submission.expiresOn
				? dayjsLib(submission.expiresOn).toISOString()
				: undefined;
			submission.isMutationAllowed = submission.isMutationAllowed === true;
			await serverGqlService.authenticatedRequest(
				request,
				CreateAccessLinkDocument,
				{ input: submission },
			);
			return Response.json({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Access link created successfully",
				}),
			});
		})
		.with("createDefaultAccessLink", async () => {
			await serverGqlService.authenticatedRequest(
				request,
				CreateAccessLinkDocument,
				{ input: { name: "Account default", isAccountDefault: true } },
			);
			return Response.json({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Account default access link created successfully",
				}),
			});
		})
		.run();
};

const updateProfileFormSchema = z.object({
	userId: z.string(),
	username: z.string().optional(),
	email: z.string().email().optional(),
	password: z.string().optional(),
});

const revokeAccessLinkFormSchema = z.object({
	accessLinkId: z.string(),
});

const createAccessLinkFormSchema = z.object({
	name: z.string(),
	expiresOn: z.string().optional(),
	redirectTo: z.string().optional(),
	maximumUses: zodIntAsString.optional(),
	isMutationAllowed: zodCheckboxAsString.optional(),
});

export default function Page() {
	const userDetails = useUserDetails();
	const loaderData = useLoaderData<typeof loader>();
	const submit = useConfirmSubmit();
	const navigate = useNavigate();
	const dashboardData = useDashboardLayoutData();
	const [
		createAccessLinkModalOpened,
		{ open: openCreateAccessLinkModal, close: closeCreateAccessLinkModal },
	] = useDisclosure(false);
	const isMobile = useIsMobile();
	const isOnboardingTourCompleted = useIsOnboardingTourCompleted();
	const { startOnboardingTour } = useOnboardingTour();

	const isEditDisabled = dashboardData.isDemoInstance;
	const defaultAccountLink = loaderData.userAccessLinks.find(
		(acl) => acl.isAccountDefault,
	);
	const hasDefaultAccountLink =
		defaultAccountLink && defaultAccountLink?.isRevoked !== true;

	return (
		<Container size="xs">
			<Tabs defaultValue="profile">
				<Tabs.List>
					<Tabs.Tab value="profile">Profile</Tabs.Tab>
					<Tabs.Tab value="sharing">Sharing</Tabs.Tab>
				</Tabs.List>
				<Box mt="md">
					<Tabs.Panel value="profile">
						<Stack>
							<Form
								method="POST"
								action={withQuery(".", { intent: "updateProfile" })}
							>
								<input
									type="hidden"
									name="userId"
									defaultValue={userDetails.id}
								/>
								<Stack>
									<TextInput
										readOnly
										description="Database generated user ID"
										defaultValue={userDetails.id}
									/>
									<TextInput
										label="Username"
										name="username"
										disabled={Boolean(isEditDisabled)}
										description={
											isEditDisabled &&
											"Username can not be changed for the demo user"
										}
										defaultValue={userDetails.name}
									/>
									<PasswordInput
										label="Password"
										name="password"
										disabled={
											Boolean(isEditDisabled) ||
											Boolean(userDetails.oidcIssuerId)
										}
										description={
											userDetails.oidcIssuerId
												? "Not applicable since this user was created via OIDC"
												: isEditDisabled
													? "Password can not be changed for the demo user"
													: undefined
										}
									/>
									<Button
										type="submit"
										onClick={(e) => {
											const form = e.currentTarget.form;
											e.preventDefault();
											openConfirmationModal(
												"Are you sure you want to update your profile?",
												() => submit(form),
											);
										}}
										fullWidth
									>
										Update
									</Button>
								</Stack>
							</Form>
							<ClientOnly>
								{() =>
									isOnboardingTourCompleted && !isMobile ? (
										<>
											<Divider />
											<Button
												variant="default"
												onClick={async () => {
													await startOnboardingTour();
													Cookies.remove(
														dashboardData.onboardingTourCompletedCookie,
													);
													navigate("/");
												}}
											>
												Restart onboarding
											</Button>
										</>
									) : null
								}
							</ClientOnly>
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="sharing">
						<Stack>
							<ClientOnly fallback={<Skeleton h={90} />}>
								{() => (
									<Paper withBorder p="md">
										<Form
											method="POST"
											action={withQuery(".", {
												intent: hasDefaultAccountLink
													? "revokeAccessLink"
													: "createDefaultAccessLink",
											})}
										>
											{hasDefaultAccountLink ? (
												<input
													readOnly
													type="hidden"
													name="accessLinkId"
													value={defaultAccountLink.id}
												/>
											) : null}
											<Group wrap="nowrap">
												<Box>
													<Text>Make my account public</Text>
													<Text size="xs" c="dimmed">
														Anyone would be able to view your profile by
														visiting {applicationBaseUrl}/u/{userDetails.name}
													</Text>
												</Box>
												<Tooltip
													disabled={!isEditDisabled}
													label="Can not change default access links for demo user"
												>
													<Button
														w="30%"
														type="submit"
														variant="light"
														disabled={isEditDisabled}
														color={hasDefaultAccountLink ? "blue" : "green"}
													>
														{hasDefaultAccountLink ? "Disable" : "Enable"}
													</Button>
												</Tooltip>
											</Group>
										</Form>
									</Paper>
								)}
							</ClientOnly>
							{loaderData.userAccessLinks.length > 0 ? (
								loaderData.userAccessLinks.map((link, idx) => (
									<DisplayAccessLink
										accessLink={link}
										key={`${link.id}-${idx}`}
										isEditDisabled={isEditDisabled}
									/>
								))
							) : (
								<Text>No access links configured</Text>
							)}
							<Flex w="100%">
								<Button
									size="xs"
									variant="light"
									radius="md"
									onClick={openCreateAccessLinkModal}
									ml="auto"
								>
									Create new access link
								</Button>
								<CreateAccessLinkModal
									createModalOpened={createAccessLinkModalOpened}
									closeModal={closeCreateAccessLinkModal}
								/>
							</Flex>
						</Stack>
					</Tabs.Panel>
				</Box>
			</Tabs>
		</Container>
	);
}

type AccessLink = UserAccessLinksQuery["userAccessLinks"][number];

const DisplayAccessLink = (props: {
	accessLink: AccessLink;
	isEditDisabled: boolean;
}) => {
	const userDetails = useUserDetails();
	const [parent] = useAutoAnimate();
	const [inputOpened, { toggle: inputToggle }] = useDisclosure(false);
	const submit = useConfirmSubmit();
	const loaderData = useLoaderData<typeof loader>();

	const accessLinkUrl = `${applicationBaseUrl}/${
		props.accessLink.isAccountDefault
			? `u/${userDetails.name}`
			: `_s/${props.accessLink.id}`
	}`;

	const optionalDetails = [
		props.accessLink.expiresOn
			? `Expiry: ${dayjsLib(props.accessLink.expiresOn).fromNow()}`
			: null,
		isNumber(props.accessLink.maximumUses)
			? `Maximum uses: ${props.accessLink.maximumUses}`
			: null,
		props.accessLink.isMutationAllowed ? "Mutation allowed" : null,
	]
		.filter(isString)
		.join(", ");

	return (
		<Paper p="xs" withBorder>
			<Stack ref={parent}>
				<Flex align="center" justify="space-between">
					<Box>
						<Indicator
							inline
							disabled={loaderData.activeAccessLinkId !== props.accessLink.id}
						>
							<Text fw="bold" span>
								{props.accessLink.name}
							</Text>
						</Indicator>
						<Text size="sm">
							Created: {dayjsLib(props.accessLink.createdOn).fromNow()}, Times
							Used:{" "}
							{formatQuantityWithCompactNotation(props.accessLink.timesUsed)}
						</Text>
						{optionalDetails ? <Text size="xs">{optionalDetails}</Text> : null}
					</Box>
					<Group wrap="nowrap">
						{props.accessLink.isRevoked !== true ? (
							<>
								<ActionIcon color="blue" onClick={inputToggle}>
									{inputOpened ? <IconEyeClosed /> : <IconEye />}
								</ActionIcon>
								<Form
									method="POST"
									action={withQuery(".", { intent: "revokeAccessLink" })}
								>
									<input
										type="hidden"
										name="accessLinkId"
										defaultValue={props.accessLink.id}
									/>
									<Tooltip
										label="Can not revoke access links for demo user"
										disabled={!props.isEditDisabled}
									>
										<ActionIcon
											mt={4}
											color="red"
											type="submit"
											variant="subtle"
											disabled={props.isEditDisabled || undefined}
											onClick={(e) => {
												const form = e.currentTarget.form;
												e.preventDefault();
												openConfirmationModal(
													"Are you sure you want to revoke this access link?",
													() => submit(form),
												);
											}}
										>
											<IconLock />
										</ActionIcon>
									</Tooltip>
								</Form>
							</>
						) : (
							<>
								<ThemeIcon color="red" size="lg" variant="outline">
									<IconLockAccess />
								</ThemeIcon>
								<Text size="xs" c="dimmed">
									Revoked
								</Text>
							</>
						)}
					</Group>
				</Flex>
				{inputOpened ? (
					<TextInput
						readOnly
						value={accessLinkUrl}
						onClick={(e) => e.currentTarget.select()}
						description="Share this link with others to give them access to your data"
					/>
				) : null}
			</Stack>
		</Paper>
	);
};

const CreateAccessLinkModal = (props: {
	createModalOpened: boolean;
	closeModal: () => void;
}) => {
	const coreDetails = useCoreDetails();
	const defaultExpiresAtValue = dayjsLib()
		.add(coreDetails.tokenValidForDays, "day")
		.toDate();

	return (
		<Modal
			opened={props.createModalOpened}
			onClose={props.closeModal}
			centered
			withCloseButton={false}
		>
			<Form
				replace
				method="POST"
				onSubmit={() => props.closeModal()}
				action={withQuery(".", { intent: "createAccessLink" })}
			>
				<Stack>
					<Title order={3}>Create new access link</Title>
					<Text size="xs" c="dimmed">
						Once a link has become invalid or been revoked, it will be
						automatically deleted. If none of the below are provided, the link
						will never expire and have unlimited uses.
					</Text>
					<TextInput
						required
						name="name"
						label="Name"
						description="A descriptive name for this link"
					/>
					<DateTimePicker
						clearable
						name="expiresOn"
						label="Expires at"
						defaultValue={defaultExpiresAtValue}
						description="This link will become invalid after this timestamp"
					/>
					<NumberInput
						name="maximumUses"
						label="Maximum uses"
						description="This link will become invalid after this number of uses"
					/>
					<TextInput
						name="redirectTo"
						label="Redirect to"
						description="Users will be redirected to this URL when they use the link"
					/>
					<Checkbox
						label="Allow mutation"
						name="isMutationAllowed"
						description="Allow users to able to change your data?"
					/>
					<Button type="submit">Submit</Button>
				</Stack>
			</Form>
		</Modal>
	);
};
