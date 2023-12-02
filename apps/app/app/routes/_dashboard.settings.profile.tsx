import {
	Box,
	Button,
	Container,
	PasswordInput,
	Stack,
	TextInput,
	Title,
} from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getCoreDetails, getUserDetails } from "~/lib/graphql.server";

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

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container size="xs">
			<Stack>
				<Title>Profile settings</Title>
				<Box component="form">
					<Stack>
						<TextInput
							label="Username"
							disabled={!loaderData.coreDetails.usernameChangeAllowed}
							description={
								!loaderData.coreDetails.usernameChangeAllowed &&
								"Username can not be changed on this instance"
							}
							defaultValue={loaderData.userDetails.name}
						/>
						<TextInput
							label="Email"
							autoFocus
							defaultValue={loaderData.userDetails.email ?? undefined}
						/>
						<PasswordInput
							label="Password"
							disabled={!loaderData.coreDetails.passwordChangeAllowed}
							description={
								!loaderData.coreDetails.passwordChangeAllowed &&
								"Password can not be changed on this instance"
							}
						/>
						<Button type="submit" fullWidth>
							Update
						</Button>
					</Stack>
				</Box>
			</Stack>
		</Container>
	);
}
