import {
	Button,
	Container,
	PasswordInput,
	Stack,
	TextInput,
	Title,
} from "@mantine/core";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	type MetaArgs_SingleFetch,
	useFetcher,
	useLoaderData,
} from "@remix-run/react";
import { UpdateUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { useRef } from "react";
import { z } from "zod";
import { confirmWrapper } from "~/components/confirmation";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getUserDetails,
	gqlClient,
} from "~/lib/utilities.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async ({ request }) => {
	const [userDetails] = await Promise.all([getUserDetails(request)]);
	return { userDetails };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Profile Settings | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.formData();
	const submission = processSubmission(formData, updateProfileFormSchema);
	await gqlClient.request(
		UpdateUserDocument,
		{ input: submission },
		await getAuthorizationHeader(request),
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
	const loaderData = useLoaderData<typeof loader>();
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
							defaultValue={loaderData.userDetails.id}
						/>
						<TextInput
							label="Username"
							name="username"
							disabled={Boolean(loaderData.userDetails.isDemo)}
							description={
								loaderData.userDetails.isDemo &&
								"Username can not be changed for the demo user"
							}
							defaultValue={loaderData.userDetails.name}
						/>
						<PasswordInput
							label="Password"
							name="password"
							disabled={
								Boolean(loaderData.userDetails.isDemo) ||
								Boolean(loaderData.userDetails.oidcIssuerId)
							}
							description={
								loaderData.userDetails.oidcIssuerId
									? "Not applicable since this user was created via OIDC"
									: loaderData.userDetails.isDemo
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
