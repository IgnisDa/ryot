import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import {
	Alert,
	Button,
	Container,
	PasswordInput,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { SetPasswordViaSessionDocument } from "@ryot/generated/graphql/backend/graphql";
import { parseSearchQuery } from "@ryot/ts-utils";
import { IconLock } from "@tabler/icons-react";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { z } from "zod";
import { passwordConfirmationSchema } from "~/lib/shared/validation";
import {
	createToastHeaders,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/change-password";

const searchParamsSchema = z.object({ sessionId: z.string() });

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const query = parseSearchQuery(request, searchParamsSchema);

	if (!query.sessionId) {
		return redirectWithToast($path("/auth"), {
			type: "error",
			message: "Invalid or missing session ID",
		});
	}

	return { sessionId: query.sessionId };
};

export const meta = () => [{ title: "Set Password | Ryot" }];

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();

	const submission = parseWithZod(formData, { schema: setPasswordSchema });

	if (submission.status !== "success") {
		return data(
			{ result: submission.reply() },
			{
				headers: await createToastHeaders({
					type: "error",
					message: "Please check the form for errors",
				}),
			},
		);
	}

	await serverGqlService.request(SetPasswordViaSessionDocument, {
		input: {
			password: submission.value.password,
			sessionId: submission.value.sessionId,
		},
	});

	return redirectWithToast($path("/auth"), {
		type: "success",
		message:
			"Password set successfully. You can now log in with your new password.",
	});
};

const setPasswordSchema = passwordConfirmationSchema.safeExtend({
	sessionId: z.string(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const actionData = useActionData<typeof action>();
	const [form, fields] = useForm({
		shouldValidate: "onBlur",
		shouldRevalidate: "onInput",
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: setPasswordSchema });
		},
	});

	return (
		<Container size="sm">
			<Stack align="center" gap="xl" mt="xl" p="xl">
				<Stack align="center" gap="sm">
					<IconLock size={48} color="var(--mantine-color-blue-6)" />
					<Title order={1} ta="center">
						Set Your Password
					</Title>
					<Text c="dimmed" ta="center">
						Please enter a new password for your account
					</Text>
				</Stack>

				<Form method="POST" style={{ width: "100%" }} {...getFormProps(form)}>
					<input type="hidden" name="sessionId" value={loaderData.sessionId} />
					<input type="hidden" name="intent" value="setPassword" />

					<Stack gap="md">
						<PasswordInput
							required
							label="New Password"
							placeholder="Enter your new password"
							{...getInputProps(fields.password, { type: "password" })}
							error={fields.password.errors?.[0]}
						/>

						<PasswordInput
							required
							label="Confirm Password"
							placeholder="Confirm your new password"
							{...getInputProps(fields.confirm, { type: "password" })}
							error={fields.confirm.errors?.[0]}
						/>

						{form.errors && (
							<Alert color="red" title="Error">
								{form.errors.join(", ")}
							</Alert>
						)}

						<Button type="submit" size="md" fullWidth mt="md">
							Set Password
						</Button>
					</Stack>
				</Form>

				<Text size="sm" c="dimmed" ta="center">
					After setting your password, you'll be redirected to the login page
				</Text>
			</Stack>
		</Container>
	);
}
