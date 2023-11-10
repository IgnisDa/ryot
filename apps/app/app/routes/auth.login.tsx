import { conform, useForm } from "@conform-to/react";
import { parse } from "@conform-to/zod";
import { Anchor, Box, Button, PasswordInput, TextInput } from "@mantine/core";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
	redirect,
} from "@remix-run/node";
import {
	Form,
	Link,
	useActionData,
	useLoaderData,
	useSearchParams,
} from "@remix-run/react";
import {
	LoginErrorVariant,
	LoginUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { safeRedirect } from "remix-utils/safe-redirect";
import { match } from "ts-pattern";
import { z } from "zod";
import { gqlClient } from "~/lib/api.server";
import { APP_ROUTES } from "~/lib/constants";
import { getCoreDetails, getCoreEnabledFeatures } from "~/lib/graphql.server";
import { checkHoneypot } from "~/lib/honeypot.server";
import { createToastHeaders } from "~/lib/toast.server";
import classes from "~/styles/auth.module.css";

export const redirectToQueryParam = "redirectTo";

const schema = z.object({
	username: z.string(),
	password: z.string().min(8),
	[redirectToQueryParam]: z.string().optional(),
});

export const meta: MetaFunction = () => [{ title: "Login | Ryot" }];

export const loader = async (_args: LoaderFunctionArgs) => {
	const enabledFeatures = await getCoreEnabledFeatures();
	const coreDetails = await getCoreDetails();
	return json({ enabledFeatures, coreDetails });
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	checkHoneypot(formData);
	const submission = parse(formData, { schema });
	if (submission.intent !== "submit")
		return json({ status: "idle", submission } as const);
	if (!submission.value)
		return json({ status: "error", submission } as const, { status: 400 });
	const { loginUser } = await gqlClient.request(LoginUserDocument, {
		input: {
			password: submission.value.password,
			username: submission.value.username,
		},
	});
	if (loginUser.__typename === "LoginResponse") {
		let redirectUrl = APP_ROUTES.dashboard as string;
		if (submission.value[redirectToQueryParam])
			redirectUrl = safeRedirect(submission.value[redirectToQueryParam]);
		return redirect(redirectUrl);
	}
	const message = match(loginUser.error)
		.with(
			LoginErrorVariant.CredentialsMismatch,
			() => "The password provided was incorrect",
		)
		.with(
			LoginErrorVariant.UsernameDoesNotExist,
			() => "The username provided does not exist",
		)
		.exhaustive();
	return json({ status: "error", submission, message } as const, {
		headers: await createToastHeaders({
			message,
			type: "error",
		}),
	});
};

export default function Page() {
	const [searchParams] = useSearchParams();
	const loaderData = useLoaderData<typeof loader>();
	const lastSubmission = useActionData<typeof action>();
	const [form, fields] = useForm({
		lastSubmission: lastSubmission?.submission,
		defaultValue: {
			redirectTo: searchParams.get(redirectToQueryParam) ?? "",
		},
	});

	return (
		<>
			<Box
				component={Form}
				m="auto"
				className={classes.form}
				method="post"
				{...form.props}
			>
				<HoneypotInputs />
				<TextInput
					id="username-input"
					{...conform.input(fields.username)}
					label="Username"
					autoFocus
					required
					defaultValue={
						loaderData.coreDetails.defaultCredentials ? "demo" : undefined
					}
				/>
				<PasswordInput
					id="password-input"
					label="Password"
					{...conform.input(fields.password)}
					mt="md"
					required
					defaultValue={
						loaderData.coreDetails.defaultCredentials
							? "demo-password"
							: undefined
					}
					error={fields.password.error}
				/>
				<input
					{...conform.input(fields[redirectToQueryParam], {
						type: "hidden",
					})}
				/>
				<Button id="submit-button" mt="md" type="submit" w="100%">
					Login
				</Button>
				{loaderData.enabledFeatures.signupAllowed ? (
					<Box mt="lg" style={{ textAlign: "right" }}>
						Need an account? Register{" "}
						<Anchor to={APP_ROUTES.auth.register} component={Link}>
							here
						</Anchor>
						.
					</Box>
				) : undefined}
			</Box>
		</>
	);
}
