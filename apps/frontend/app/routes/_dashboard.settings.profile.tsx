import {
	Button,
	Container,
	PasswordInput,
	Stack,
	TextInput,
	Title,
} from "@mantine/core";
import { unstable_defineAction } from "@remix-run/node";
import { type MetaArgs_SingleFetch, useFetcher } from "@remix-run/react";
import { UpdateUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { useRef } from "react";
import { z } from "zod";
import { confirmWrapper } from "~/components/confirmation";
import { useUserDetails } from "~/lib/hooks";
import {
	createToastHeaders,
	getAuthorizationHeader,
	serverGqlService,
} from "~/lib/utilities.server";
import { processSubmission } from "~/lib/utilities.server";

export const meta = (_args: MetaArgs_SingleFetch) => {
	return [{ title: "Profile Settings | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.formData();
	const submission = processSubmission(formData, updateProfileFormSchema);
	await serverGqlService.request(
		UpdateUserDocument,
		{ input: submission },
		getAuthorizationHeader(request),
	);
	return Response.json({ status: "success", submission } as const, {
		headers: await createToastHeaders({
			message:
				"Profile updated. Please login again for changes to take effect.",
		}),
	});
});

const updateProfileFormSchema = z.object({
	username: z.string().optional(),
	email: z.string().email().optional(),
	password: z.string().optional(),
});

export default function Page() {
	const userDetails = useUserDetails();
	const fetcher = useFetcher<typeof action>();
	const formRef = useRef<HTMLFormElement>(null);

	return (
		<Container size="xs">
			<Stack>
				<Title>Profile settings</Title>
				<fetcher.Form ref={formRef} method="post">
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
								Boolean(userDetails.isDemo) || Boolean(userDetails.oidcIssuerId)
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
									confirmation: "Are you sure you want to update your profile?",
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
		</Container>
	);
}
