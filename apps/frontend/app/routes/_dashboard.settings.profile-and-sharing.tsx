import {
	Box,
	Button,
	Container,
	PasswordInput,
	Stack,
	Tabs,
	TextInput,
} from "@mantine/core";
import { unstable_defineAction } from "@remix-run/node";
import { Form } from "@remix-run/react";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { UpdateUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { ProRequiredAlert } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import { queryClient, queryFactory } from "~/lib/generals";
import { useConfirmSubmit, useUserDetails } from "~/lib/hooks";
import {
	createToastHeaders,
	getAuthorizationCookie,
	serverGqlService,
} from "~/lib/utilities.server";
import { processSubmission } from "~/lib/utilities.server";

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
	});
});

const updateProfileFormSchema = z.object({
	userId: z.string(),
	username: z.string().optional(),
	email: z.string().email().optional(),
	password: z.string().optional(),
});

export default function Page() {
	const userDetails = useUserDetails();
	const submit = useConfirmSubmit();
	const isEditDisabled = false;

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
										onClick={async (e) => {
											const form = e.currentTarget.form;
											e.preventDefault();
											const conf = await confirmWrapper({
												confirmation:
													"Are you sure you want to update your profile?",
											});
											if (conf && form) submit(form);
										}}
										fullWidth
									>
										Update
									</Button>
								</Stack>
							</Form>
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="sharing">
						<Stack>
							<ProRequiredAlert tooltipLabel="Allow others to see your favorite media without signing up" />
						</Stack>
					</Tabs.Panel>
				</Box>
			</Tabs>
		</Container>
	);
}
