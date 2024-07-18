import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Modal,
	NumberInput,
	Paper,
	PasswordInput,
	Stack,
	Tabs,
	Text,
	TextInput,
	ThemeIcon,
	Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	type MetaArgs_SingleFetch,
	useFetcher,
	useLoaderData,
} from "@remix-run/react";
import {
	CreateAccessLinkDocument,
	RevokeAccessLinkDocument,
	UpdateUserDocument,
	UserAccessLinksDocument,
	type UserAccessLinksQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, isString } from "@ryot/ts-utils";
import {
	IconEye,
	IconEyeClosed,
	IconLock,
	IconLockAccess,
} from "@tabler/icons-react";
import { useRef } from "react";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import { dayjsLib, queryClient, queryFactory } from "~/lib/generals";
import { useCoreDetails, useUserDetails } from "~/lib/hooks";
import {
	createToastHeaders,
	getAuthorizationCookie,
	serverGqlService,
} from "~/lib/utilities.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async ({ request }) => {
	const [{ userAccessLinks }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UserAccessLinksDocument, {}),
	]);
	return { userAccessLinks };
});

export const meta = (_args: MetaArgs_SingleFetch) => {
	return [{ title: "Profile and Sharing | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.formData();
	return namedAction(request, {
		updateProfile: async () => {
			const token = getAuthorizationCookie(request);
			const submission = processSubmission(formData, updateProfileFormSchema);
			await serverGqlService.authenticatedRequest(request, UpdateUserDocument, {
				input: submission,
			});
			queryClient.removeQueries({
				queryKey: queryFactory.users.details(token).queryKey,
			});
			return Response.json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Profile updated successfully",
				}),
			});
		},
		revokeAccessLink: async () => {
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
		},
		createAccessLink: async () => {
			const submission = processSubmission(
				formData,
				createAccessLinkFormSchema,
			);
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
		},
	});
});

const updateProfileFormSchema = z.object({
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
	maximumUses: zx.IntAsString.optional(),
});

export default function Page() {
	const userDetails = useUserDetails();
	const loaderData = useLoaderData<typeof loader>();
	const fetcher = useFetcher<typeof action>();
	const formRef = useRef<HTMLFormElement>(null);
	const [
		createAccessLinkModalOpened,
		{ open: openCreateAccessLinkModal, close: closeCreateAccessLinkModal },
	] = useDisclosure(false);

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
							<Title>Profile</Title>
							<fetcher.Form
								ref={formRef}
								method="POST"
								action={withQuery(".", { intent: "updateProfile" })}
							>
								<Stack>
									<TextInput
										readOnly
										description="Database generated user ID"
										defaultValue={userDetails.id}
									/>
									<TextInput
										label="Username"
										name="username"
										disabled={Boolean(userDetails.isDemo)}
										description={
											userDetails.isDemo &&
											"Username can not be changed for the demo user"
										}
										defaultValue={userDetails.name}
									/>
									<PasswordInput
										label="Password"
										name="password"
										disabled={
											Boolean(userDetails.isDemo) ||
											Boolean(userDetails.oidcIssuerId)
										}
										description={
											userDetails.oidcIssuerId
												? "Not applicable since this user was created via OIDC"
												: userDetails.isDemo
													? "Password can not be changed for the demo user"
													: undefined
										}
									/>
									<Button
										onClick={async () => {
											const conf = await confirmWrapper({
												confirmation:
													"Are you sure you want to update your profile?",
											});
											if (conf) fetcher.submit(formRef.current);
										}}
										fullWidth
									>
										Update
									</Button>
								</Stack>
							</fetcher.Form>
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="sharing">
						<Stack>
							<Title>Sharing</Title>
							{loaderData.userAccessLinks.length > 0 ? (
								loaderData.userAccessLinks.map((link, idx) => (
									<DisplayAccessLink
										accessLink={link}
										key={`${link.id}-${idx}`}
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

const DisplayAccessLink = (props: { accessLink: AccessLink }) => {
	const [parent] = useAutoAnimate();
	const [inputOpened, { toggle: inputToggle }] = useDisclosure(false);
	const fetcher = useFetcher<typeof action>();
	const deleteFormRef = useRef<HTMLFormElement>(null);

	const accessLinkUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/_s/${props.accessLink.id}`
			: "";

	const optionalDetails = [
		props.accessLink.expiresOn
			? `Expiry: ${dayjsLib(props.accessLink.expiresOn).fromNow()}`
			: null,
		isNumber(props.accessLink.maximumUses)
			? `Maximum uses: ${props.accessLink.maximumUses}`
			: null,
	]
		.filter(isString)
		.join(", ");

	return (
		<Paper p="xs" withBorder data-access-link-url={accessLinkUrl}>
			<Stack ref={parent}>
				<Flex align="center" justify="space-between">
					<Box>
						<Text fw="bold" span>
							{props.accessLink.name}
						</Text>
						<Text size="sm">
							Created: {dayjsLib(props.accessLink.createdOn).fromNow()}, Times
							Used: {props.accessLink.timesUsed}
						</Text>
						{optionalDetails ? <Text size="xs">{optionalDetails}</Text> : null}
					</Box>
					<Group wrap="nowrap">
						{props.accessLink.isRevoked !== true ? (
							<>
								<ActionIcon color="blue" onClick={inputToggle}>
									{inputOpened ? <IconEyeClosed /> : <IconEye />}
								</ActionIcon>
								<fetcher.Form
									method="POST"
									ref={deleteFormRef}
									action={withQuery("", { intent: "revokeAccessLink" })}
								>
									<input
										type="hidden"
										name="accessLinkId"
										defaultValue={props.accessLink.id}
									/>
									<ActionIcon
										color="red"
										variant="subtle"
										mt={4}
										onClick={async () => {
											const conf = await confirmWrapper({
												confirmation:
													"Are you sure you want to revoke this access link?",
											});
											if (conf) fetcher.submit(deleteFormRef.current);
										}}
									>
										<IconLock />
									</ActionIcon>
								</fetcher.Form>
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
						value={accessLinkUrl}
						readOnly
						onClick={(e) => e.currentTarget.select()}
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
				action={withQuery("", { intent: "createAccessLink" })}
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
						label="Name"
						name="name"
						description="A descriptive name for this link"
					/>
					<DateTimePicker
						label="Expires at"
						name="expiresOn"
						description="This link will become invalid after this timestamp"
						defaultValue={defaultExpiresAtValue}
					/>
					<NumberInput
						label="Maximum uses"
						name="maximumUses"
						description="This link will become invalid after this number of uses"
					/>
					<Button type="submit">Submit</Button>
				</Stack>
			</Form>
		</Modal>
	);
};
