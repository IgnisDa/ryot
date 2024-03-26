import {
	Button,
	Container,
	PasswordInput,
	Stack,
	TextInput,
	Title,
} from "@mantine/core";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [userDetails] = await Promise.all([getUserDetails(request)]);
	return json({ userDetails });
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
	const fetcher = useFetcher();
	const formRef = useRef<HTMLFormElement>(null);

	return (
		<Container size="xs">
			<Stack>
				<Title>Profile settings</Title>
				<fetcher.Form ref={formRef} method="post">
					<Stack>
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
						<TextInput
							label="Email"
							name="email"
							autoFocus
							defaultValue={loaderData.userDetails.email ?? undefined}
						/>
						<PasswordInput
							label="Password"
							name="password"
							disabled={Boolean(loaderData.userDetails.isDemo)}
							description={
								loaderData.userDetails.isDemo &&
								"Password can not be changed for the demo user"
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
