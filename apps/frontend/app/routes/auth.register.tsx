import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { $path } from "@ignisda/remix-routes";
import { Anchor, Box, Button, PasswordInput, TextInput } from "@mantine/core";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { Form, Link } from "@remix-run/react";
import {
	RegisterErrorVariant,
	RegisterUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";
import { z } from "zod";
import {
	createToastHeaders,
	getCoreEnabledFeatures,
	getIsAuthenticated,
	gqlClient,
	redirectWithToast,
} from "~/lib/utilities.server";
import classes from "~/styles/auth.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [isAuthenticated, _] = await getIsAuthenticated(request);
	if (isAuthenticated)
		return redirectWithToast($path("/"), {
			message: "You were already logged in",
		});
	const enabledFeatures = await getCoreEnabledFeatures();
	if (!enabledFeatures.signupAllowed)
		return redirectWithToast($path("/auth/login"), {
			message: "Registration is disabled",
			type: "error",
		});
	return json({});
};

export const meta: MetaFunction = () => [{ title: "Register | Ryot" }];

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	const submission = parseWithZod(formData, { schema });
	if (submission.status !== "success")
		return json(
			{ status: "error" },
			{
				status: 400,
				headers: await createToastHeaders({
					type: "error",
					message:
						submission.error?.password?.at(0) ||
						submission.error?.confirm?.at(0) ||
						"Invalid form data",
				}),
			},
		);
	const { registerUser } = await gqlClient.request(RegisterUserDocument, {
		input: {
			password: submission.value.password,
			username: submission.value.username,
		},
	});
	if (registerUser.__typename === "RegisterError") {
		const message = match(registerUser.error)
			.with(RegisterErrorVariant.Disabled, () => "Registration is disabled")
			.with(
				RegisterErrorVariant.UsernameAlreadyExists,
				() => "This username already exists",
			)
			.exhaustive();
		return json({ status: "error" } as const, {
			status: 400,
			headers: await createToastHeaders({ message, type: "error" }),
		});
	}
	return redirectWithToast($path("/auth/login"), {
		type: "success",
		message: "Please login with your new credentials",
	});
};

const schema = z
	.object({
		username: z.string(),
		password: z
			.string()
			.min(8, "Password should be at least 8 characters long"),
		confirm: z.string(),
	})
	.refine((data) => data.password === data.confirm, {
		message: "Passwords do not match",
		path: ["confirm"],
	});

export default function Page() {
	const [form, fields] = useForm({});

	return (
		<>
			<Box
				component={Form}
				m="auto"
				className={classes.form}
				method="post"
				{...getFormProps(form)}
			>
				<TextInput
					{...getInputProps(fields.username, { type: "text" })}
					label="Username"
					autoFocus
					required
					error={fields.username.errors?.[0]}
				/>
				<PasswordInput
					label="Password"
					{...getInputProps(fields.password, { type: "password" })}
					mt="md"
					required
					error={fields.password.errors?.[0]}
				/>
				<PasswordInput
					label="Confirm password"
					mt="md"
					{...getInputProps(fields.confirm, { type: "password" })}
					required
					error={fields.confirm.errors?.[0]}
				/>
				<Button id="submit-button" mt="md" type="submit" w="100%">
					Register
				</Button>
				<Box mt="lg" ta="right">
					Already{" "}
					<Anchor to={$path("/auth/login")} component={Link}>
						have an account
					</Anchor>
					?
				</Box>
			</Box>
		</>
	);
}
