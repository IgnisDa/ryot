import type { NextPageWithLayout } from "./_app";
import useUser from "@/lib/hooks/useUser";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Button,
	Container,
	PasswordInput,
	Stack,
	Tabs,
	TextInput,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	UpdateUserDocument,
	type UpdateUserMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { IconUser } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { z } from "zod";

const formSchema = z.object({
	username: z.string().optional(),
	password: z.string().optional(),
	email: z.string().optional(),
});
type FormSchema = z.infer<typeof formSchema>;

const Page: NextPageWithLayout = () => {
	const form = useForm<FormSchema>({ validate: zodResolver(formSchema) });
	useUser((data) => {
		form.setValues({
			email: data.email,
			username: data.name,
		});
		form.resetDirty();
	});
	const updateUser = useMutation({
		mutationFn: async (variables: UpdateUserMutationVariables) => {
			const { updateUser } = await gqlClient.request(
				UpdateUserDocument,
				variables,
			);
			return updateUser;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Profile details updated",
				color: "green",
			});
		},
	});

	return (
		<Container size="xs">
			<Stack>
				<Tabs defaultValue="profile">
					<Tabs.List mb={"sm"}>
						<Tabs.Tab value="profile" icon={<IconUser size="1rem" />}>
							Profile
						</Tabs.Tab>
					</Tabs.List>
					<Tabs.Panel value="profile">
						<Box
							component="form"
							onSubmit={form.onSubmit((values) => {
								updateUser.mutate({ input: values });
							})}
						>
							<Stack>
								<TextInput
									label="Username"
									{...form.getInputProps("username")}
									autoFocus
								/>
								<TextInput
									label="Email"
									{...form.getInputProps("email")}
									autoFocus
								/>
								<PasswordInput
									label="Password"
									{...form.getInputProps("password")}
								/>
								<Button type="submit" loading={updateUser.isLoading} w="100%">
									Update
								</Button>
							</Stack>
						</Box>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
