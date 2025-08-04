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
import { getActionIntent, parseSearchQuery } from "@ryot/ts-utils";
import { IconLock } from "@tabler/icons-react";
import { Form, data, useActionData, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { z } from "zod";
import {
	createToastHeaders,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/change-password";

const searchParamsSchema = z.object({
	sessionId: z.string(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const query = parseSearchQuery(request, searchParamsSchema);

	if (!query.sessionId) {
		return redirectWithToast($path("/auth"), {
			type: "error",
			message: "Invalid or missing session ID",
		});
	}

	// Validate session exists by attempting to use it (this doesn't consume it)
	try {
		// We can't validate without consuming the session, so we'll just proceed
		// The actual validation will happen in the action
		return {
			sessionId: query.sessionId,
		};
	} catch {
		return redirectWithToast($path("/auth"), {
			type: "error",
			message: "Session not found or expired",
		});
	}
};

export const meta = () => [{ title: "Set Password | Ryot" }];

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);

	return await match(intent)
		.with("setPassword", async () => {
			const submission = parseWithZod(formData, {
				schema: setPasswordSchema,
			});

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

			try {
				await serverGqlService.request(SetPasswordViaSessionDocument, {
					input: {
						sessionId: submission.value.sessionId,
						password: submission.value.password,
					},
				});

				return redirectWithToast($path("/auth"), {
					type: "success",
					message:
						"Password set successfully. You can now log in with your new password.",
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Failed to set password. The session may have expired.";

				return data(
					{ result: null },
					{
						headers: await createToastHeaders({
							type: "error",
							message,
						}),
					},
				);
			}
		})
		.run();
};

const setPasswordSchema = z
	.object({
		sessionId: z.string(),
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
	const loaderData = useLoaderData<typeof loader>();
	const actionData = useActionData<typeof action>();
	const [form, fields] = useForm({
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: setPasswordSchema });
		},
		shouldValidate: "onBlur",
		shouldRevalidate: "onInput",
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

				<Form
					method="POST"
					action="/change-password"
					style={{ width: "100%" }}
					{...getFormProps(form)}
				>
					<input type="hidden" name="sessionId" value={loaderData.sessionId} />
					<input type="hidden" name="intent" value="setPassword" />

					<Stack gap="md">
						<PasswordInput
							label="New Password"
							placeholder="Enter your new password"
							required
							{...getInputProps(fields.password, { type: "password" })}
							error={fields.password.errors?.[0]}
						/>

						<PasswordInput
							label="Confirm Password"
							placeholder="Confirm your new password"
							required
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
