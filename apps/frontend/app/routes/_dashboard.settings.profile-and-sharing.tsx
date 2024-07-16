import {
	Box,
	Button,
	Container,
	PasswordInput,
	Stack,
	Tabs,
	TextInput,
	Title,
} from "@mantine/core";
import { unstable_defineAction } from "@remix-run/node";
import { type MetaArgs_SingleFetch, useFetcher } from "@remix-run/react";
import { UpdateUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { useRef } from "react";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { ProRequiredAlert } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import { queryClient, queryFactory } from "~/lib/generals";
import { useUserDetails } from "~/lib/hooks";
import {
	createToastHeaders,
	enhancedServerGqlService,
	getAuthorizationCookie,
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
			await enhancedServerGqlService.authenticatedRequest(
				request,
				UpdateUserDocument,
				{ input: submission },
			);
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
	email: z.string().email().optional(),
	password: z.string().optional(),
});

export default function Page() {
	const userDetails = useUserDetails();
	const fetcher = useFetcher<typeof action>();
	const formRef = useRef<HTMLFormElement>(null);

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
									<input readOnly hidden name="userId" value={userDetails.id} />
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
							<ProRequiredAlert tooltipLabel="Allow others to see your favorite media without signing up" />
						</Stack>
					</Tabs.Panel>
				</Box>
			</Tabs>
		</Container>
	);
}
