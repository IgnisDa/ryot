import { type UserInput } from "@trackona/generated/graphql/backend/graphql";
import { REGISTER_USER } from "@trackona/graphql/backend/mutations";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Text, Button, TextInput, PasswordInput, Box } from "@mantine/core";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { gqlClient } from "@/lib/api";
import { notifications } from "@mantine/notifications";
import { useRouter } from "next/router";

const formSchema = z
	.object({
		username: z.string(),
		password: z.string(),
		confirm: z.string(),
	})
	.refine((data) => data.password === data.confirm, {
		message: "Passwords do not match",
		path: ["confirm"],
	});
type FormSchema = z.infer<typeof formSchema>;

export default function Page() {
	const router = useRouter();
	const registerUser = useMutation({
		mutationFn: async (input: UserInput) => {
			const { registerUser } = await gqlClient.request(REGISTER_USER, {
				input,
			});
			return registerUser;
		},
		onSuccess(data) {
			if (data.__typename === "RegisterError") {
				notifications.show({
					title: "Error with registration",
					message: "This username already exists",
					color: "red",
				});
			} else {
				notifications.show({
					title: "Success",
					message: "Please login with your new credentials",
					color: "green",
				});
				router.push("/auth/login");
			}
		},
	});

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<FormSchema>({ resolver: zodResolver(formSchema) });
	const onSubmit: SubmitHandler<FormSchema> = ({ username, password }) => {
		registerUser.mutate({ username, password });
	};

	return (
		<Box
			component="form"
			my={"auto"}
			mx={"auto"}
			onSubmit={handleSubmit(onSubmit)}
			sx={(t) => ({
				width: "80%",
				[t.fn.largerThan("sm")]: { width: "60%" },
				[t.fn.largerThan("md")]: { width: "50%" },
				[t.fn.largerThan("lg")]: { width: "40%" },
				[t.fn.largerThan("xl")]: { width: "30%" },
			})}
		>
			<TextInput label="Username" {...register("username")} required />
			<PasswordInput
				label="Password"
				mt="md"
				{...register("password")}
				required
			/>
			<PasswordInput
				label="Confirm password"
				mt="md"
				{...register("confirm")}
				required
			/>
			{errors.confirm && <Text color="red">{errors.confirm.message}</Text>}
			<Button mt="md" type="submit" loading={registerUser.isLoading} w="100%">
				Register
			</Button>
		</Box>
	);
}
