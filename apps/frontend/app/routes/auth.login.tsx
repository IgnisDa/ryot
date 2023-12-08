import { conform, useForm } from "@conform-to/react";
import { $path } from "@ignisda/remix-routes";
import { Anchor, Box, Button, PasswordInput, TextInput } from "@mantine/core";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
	redirect,
} from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import {
	LoginErrorVariant,
	LoginUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { safeRedirect } from "remix-utils/safe-redirect";
import { match } from "ts-pattern";
import { z } from "zod";
import { getIsAuthenticated, gqlClient } from "~/lib/api.server";
import { authCookie } from "~/lib/cookies.server";
import { getCoreDetails, getCoreEnabledFeatures } from "~/lib/graphql.server";
import { checkHoneypot } from "~/lib/honeypot.server";
import { createToastHeaders, redirectWithToast } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";
import classes from "~/styles/auth.module.css";

export const redirectToQueryParam = "redirectTo";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [isAuthenticated, _] = await getIsAuthenticated(request);
	if (isAuthenticated)
		return redirectWithToast($path("/"), {
			message: "You were already logged in",
		});
	const enabledFeatures = await getCoreEnabledFeatures();
	const coreDetails = await getCoreDetails();
	return json({ enabledFeatures, coreDetails });
};

export const meta: MetaFunction = () => [{ title: "Login | Ryot" }];

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	checkHoneypot(formData);
	const submission = processSubmission(formData, schema);
	const { loginUser } = await gqlClient.request(LoginUserDocument, {
		input: {
			password: submission.password,
			username: submission.username,
		},
	});
	if (loginUser.__typename === "LoginResponse") {
		let redirectUrl = $path("/");
		if (submission[redirectToQueryParam])
			redirectUrl = safeRedirect(submission[redirectToQueryParam]);
		return redirect(redirectUrl, {
			headers: {
				"Set-Cookie": await authCookie.serialize(loginUser.apiKey, {
					maxAge: loginUser.validFor * 24 * 60 * 60,
				}),
			},
		});
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

const schema = z.object({
	username: z.string(),
	password: z.string(),
	[redirectToQueryParam]: z.string().optional(),
});

export default function Page() {
	const [searchParams] = useSearchParams();
	const loaderData = useLoaderData<typeof loader>();
	const [form, fields] = useForm({
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
						<Anchor to={$path("/auth/register")} component={Link}>
							here
						</Anchor>
						.
					</Box>
				) : undefined}
			</Box>
		</>
	);
}
