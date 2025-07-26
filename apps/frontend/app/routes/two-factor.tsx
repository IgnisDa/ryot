import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import {
	Anchor,
	Button,
	Center,
	Container,
	PinInput,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import {
	UserTwoFactorVerifyMethod,
	VerifyTwoFactorDocument,
	VerifyTwoFactorErrorVariant,
} from "@ryot/generated/graphql/backend/graphql";
import { parseSearchQuery } from "@ryot/ts-utils";
import { useState } from "react";
import { Form, Link, data, redirect } from "react-router";
import { safeRedirect } from "remix-utils/safe-redirect";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { z } from "zod";
import { redirectToQueryParam } from "~/lib/shared/constants";
import {
	createToastHeaders,
	getCookiesForApplication,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/two-factor";

const searchParamsSchema = z.object({
	userId: z.string(),
	[redirectToQueryParam]: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const meta = () => [{ title: "Two-Factor Authentication | Ryot" }];

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.formData();
	const query = parseSearchQuery(request, searchParamsSchema);
	const submission = parseWithZod(formData, {
		schema: verifyTwoFactorSchema,
	});

	if (submission.status !== "success") {
		return data({} as const, {
			headers: await createToastHeaders({
				type: "error",
				message: "Invalid form data",
			}),
		});
	}

	const { verifyTwoFactor } = await serverGqlService.request(
		VerifyTwoFactorDocument,
		{
			input: {
				userId: query.userId,
				code: submission.value.code,
				method: submission.value.method,
			},
		},
	);

	if (verifyTwoFactor.__typename === "ApiKeyResponse") {
		const headers = await getCookiesForApplication(verifyTwoFactor.apiKey);
		const redirectTo = query[redirectToQueryParam];
		return redirect(redirectTo ? safeRedirect(redirectTo) : $path("/"), {
			headers,
		});
	}

	const message = match(verifyTwoFactor)
		.with({ __typename: "VerifyTwoFactorError" }, (error) =>
			match(error.error)
				.with(
					VerifyTwoFactorErrorVariant.Invalid,
					() => "Invalid verification code. Please try again.",
				)
				.with(
					VerifyTwoFactorErrorVariant.RateLimited,
					() => "Too many attempts. Please wait a few seconds and try again.",
				)
				.exhaustive(),
		)
		.otherwise(() => "Verification failed. Please try again.");

	return data({} as const, {
		headers: await createToastHeaders({ message, type: "error" }),
	});
};

const verifyTwoFactorSchema = z.object({
	code: z.string(),
	method: z.enum(UserTwoFactorVerifyMethod),
});

export default function Page() {
	const [form, fields] = useForm({});
	const [useBackupCode, setUseBackupCode] = useState(false);
	const [code, setCode] = useState("");

	return (
		<Container size="xs" style={{ display: "flex", alignItems: "center" }}>
			<Stack>
				<Text size="xl" fw="bold" ta="center" mb="md">
					Two-Factor Authentication
				</Text>
				<Text size="sm" c="dimmed" ta="center" mb="lg">
					{useBackupCode
						? "Enter one of your backup codes to continue"
						: "Enter the 6-digit code from your authenticator app"}
				</Text>
				<Form method="POST" {...getFormProps(form)}>
					<input
						type="hidden"
						name="method"
						value={
							useBackupCode
								? UserTwoFactorVerifyMethod.BackupCode
								: UserTwoFactorVerifyMethod.Totp
						}
					/>
					{!useBackupCode ? (
						<Center>
							<PinInput
								{...getInputProps(fields.code, { type: "number" })}
								autoFocus
								length={6}
								value={code}
								onChange={setCode}
							/>
						</Center>
					) : (
						<TextInput
							{...getInputProps(fields.code, { type: "text" })}
							required
							autoFocus
							value={code}
							label="Backup Code"
							placeholder="Enter backup code"
							error={fields.code.errors?.[0]}
							onChange={(e) => setCode(e.target.value)}
						/>
					)}
					<Button
						mt="lg"
						w="100%"
						type="submit"
						disabled={
							(!useBackupCode && code.length !== 6) ||
							(useBackupCode && !code.trim())
						}
					>
						Verify & Continue
					</Button>
				</Form>
				<Button
					size="compact-xs"
					variant="transparent"
					onClick={() => {
						setUseBackupCode(!useBackupCode);
						setCode("");
					}}
				>
					{useBackupCode
						? "Use authenticator app instead"
						: "Use backup code instead"}
				</Button>
				<Anchor component={Link} to="/auth" ta="center">
					Back to login
				</Anchor>
			</Stack>
		</Container>
	);
}
