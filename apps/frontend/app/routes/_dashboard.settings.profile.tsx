import {
	Box,
	Button,
	Container,
	PasswordInput,
	Stack,
	TextInput,
	Title,
} from "@mantine/core";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { UpdateUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails, getUserDetails } from "~/lib/graphql.server";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, userDetails] = await Promise.all([
		getCoreDetails(),
		getUserDetails(request),
	]);
	return json({ coreDetails, userDetails });
};

export const meta: MetaFunction = () => {
	return [{ title: "Profile Settings | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	const submission = processSubmission(formData, updateProfileFormSchema);
	await gqlClient.request(
		UpdateUserDocument,
		{ input: submission },
		await getAuthorizationHeader(request),
	);
	return json({ status: "success", submission } as const, {
		headers: await createToastHeaders({
			message: "Profile updated",
		}),
	});
};

const updateProfileFormSchema = z.object({
	username: z.string().optional(),
	email: z.string().email().optional(),
	password: z.string().optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container size="xs">
			<Stack>
				<Title>Profile settings</Title>
				<Box component={Form} method="post">
					<Stack>
						<TextInput
							label="Username"
							name="username"
							disabled={!loaderData.coreDetails.usernameChangeAllowed}
							description={
								!loaderData.coreDetails.usernameChangeAllowed &&
								"Username can not be changed on this instance"
							}
							defaultValue={loaderData.userDetails.name}
						/>
						<TextInput
							label="Email"
							name="email"
							autoFocus
							defaultValue={loaderData.userDetails.email ?? undefined}
						/>
						<PasswordInput
							label="Password"
							name="password"
							disabled={!loaderData.coreDetails.passwordChangeAllowed}
							description={
								!loaderData.coreDetails.passwordChangeAllowed &&
								"Password can not be changed on this instance"
							}
						/>
						<Button
							type="submit"
							fullWidth
							onClick={(e) => {
								if (!confirm("Are you sure you want to update your profile?"))
									e.preventDefault();
							}}
						>
							Update
						</Button>
					</Stack>
				</Box>
			</Stack>
		</Container>
	);
}
