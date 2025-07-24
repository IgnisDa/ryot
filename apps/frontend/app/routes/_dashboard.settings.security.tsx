import {
	Button,
	Container,
	PasswordInput,
	Stack,
	TextInput,
} from "@mantine/core";
import { UpdateUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { getActionIntent, processSubmission } from "@ryot/ts-utils";
import { Form } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	useConfirmSubmit,
	useDashboardLayoutData,
	useUserDetails,
} from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.security";

export const loader = async ({ request }: Route.LoaderArgs) => {
	return {};
};

export const meta = () => {
	return [{ title: "Security | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("updateProfile", async () => {
			const submission = processSubmission(formData, updateProfileFormSchema);
			await serverGqlService.authenticatedRequest(request, UpdateUserDocument, {
				input: submission,
			});
			return Response.json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Profile updated successfully",
				}),
			});
		})
		.run();
};

const updateProfileFormSchema = z.object({
	userId: z.string(),
	username: z.string().optional(),
	email: z.string().email().optional(),
	password: z.string().optional(),
});

export default function Page() {
	const userDetails = useUserDetails();
	const submit = useConfirmSubmit();
	const dashboardData = useDashboardLayoutData();

	const isEditDisabled = dashboardData.isDemoInstance;

	return (
		<Container size="xs">
			<Stack>
				<Form
					method="POST"
					action={withQuery(".", { intent: "updateProfile" })}
				>
					<input type="hidden" name="userId" defaultValue={userDetails.id} />
					<Stack>
						<TextInput
							readOnly
							description="Database generated user ID"
							defaultValue={userDetails.id}
						/>
						<TextInput
							label="Username"
							name="username"
							disabled={Boolean(isEditDisabled)}
							description={
								isEditDisabled &&
								"Username can not be changed for the demo user"
							}
							defaultValue={userDetails.name}
						/>
						<PasswordInput
							label="Password"
							name="password"
							disabled={
								Boolean(isEditDisabled) || Boolean(userDetails.oidcIssuerId)
							}
							description={
								userDetails.oidcIssuerId
									? "Not applicable since this user was created via OIDC"
									: isEditDisabled
										? "Password can not be changed for the demo user"
										: undefined
							}
						/>
						<Button
							type="submit"
							onClick={(e) => {
								const form = e.currentTarget.form;
								e.preventDefault();
								openConfirmationModal(
									"Are you sure you want to update your profile?",
									() => submit(form),
								);
							}}
							fullWidth
						>
							Update
						</Button>
					</Stack>
				</Form>
			</Stack>
		</Container>
	);
}
