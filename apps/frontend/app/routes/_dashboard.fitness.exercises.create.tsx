import { $path } from "@ignisda/remix-routes";
import {
	Button,
	Container,
	FileInput,
	Group,
	MultiSelect,
	Select,
	Stack,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
	redirect,
	unstable_parseMultipartFormData,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	CreateCustomExerciseDocument,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, cloneDeep } from "@ryot/ts-utils";
import { IconPhoto } from "@tabler/icons-react";
import { ClientError } from "graphql-request";
import { z } from "zod";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getCoreEnabledFeatures,
	gqlClient,
	processSubmission,
	s3FileUploader,
} from "~/lib/utilities.server";

export const loader = async (_args: LoaderFunctionArgs) => {
	const [coreEnabledFeatures] = await Promise.all([getCoreEnabledFeatures()]);
	return json({
		coreEnabledFeatures: { fileStorage: coreEnabledFeatures.fileStorage },
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Create Exercise | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const uploaders = s3FileUploader("exercises");
	const formData = await unstable_parseMultipartFormData(request, uploaders);
	const submission = processSubmission(formData, schema);
	const muscles = submission.muscles
		? (submission.muscles.split(",") as ExerciseMuscle[])
		: [];
	const instructions = submission.instructions;
	const newInput = cloneDeep(submission);
	newInput.muscles = undefined;
	newInput.instructions = undefined;
	newInput.images = undefined;
	const input = {
		...newInput,
		muscles,
		attributes: {
			images: submission.images || [],
			instructions: instructions?.split("\n") || [],
		},
	};
	try {
		const { createCustomExercise } = await gqlClient.request(
			CreateCustomExerciseDocument,
			{ input },
			await getAuthorizationHeader(request),
		);
		return redirect(
			$path("/fitness/exercises/:id", { id: createCustomExercise }),
		);
	} catch (e) {
		if (e instanceof ClientError && e.response.errors) {
			const message = e.response.errors[0].message;
			return json(
				{ error: e.message },
				{
					status: 400,
					headers: await createToastHeaders({ message, type: "error" }),
				},
			);
		}
		throw e;
	}
};

const optionalString = z.string().optional();
const optionalStringArray = z.array(z.string()).optional();

const schema = z.object({
	id: z.string(),
	lot: z.nativeEnum(ExerciseLot),
	level: z.nativeEnum(ExerciseLevel),
	force: z.nativeEnum(ExerciseForce).optional(),
	mechanic: z.nativeEnum(ExerciseMechanic).optional(),
	equipment: z.nativeEnum(ExerciseEquipment).optional(),
	muscles: optionalString,
	instructions: optionalString,
	images: optionalStringArray,
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	const fileUploadNowAllowed = !loaderData.coreEnabledFeatures.fileStorage;

	return (
		<Container>
			<Form method="post" replace encType="multipart/form-data">
				<Stack>
					<Title>Create Exercise</Title>
					<TextInput label="Name" required autoFocus name="id" />
					<Select
						label="Type"
						data={Object.values(ExerciseLot).map((l) => ({
							value: l,
							label: changeCase(l),
						}))}
						required
						name="lot"
					/>
					<Group wrap="nowrap">
						<Select
							label="Level"
							data={Object.values(ExerciseLevel)}
							required
							name="level"
							w={{ base: "100%", md: "50%" }}
						/>
						<Select
							label="Force"
							data={Object.values(ExerciseForce)}
							name="force"
							w={{ base: "100%", md: "50%" }}
						/>
					</Group>
					<Group wrap="nowrap">
						<Select
							label="Equipment"
							data={Object.values(ExerciseEquipment)}
							name="equipment"
							w={{ base: "100%", md: "50%" }}
						/>
						<Select
							label="Mechanic"
							data={Object.values(ExerciseMechanic)}
							name="mechanic"
							w={{ base: "100%", md: "50%" }}
						/>
					</Group>
					<MultiSelect
						label="Muscles"
						data={Object.values(ExerciseMuscle)}
						name="muscles"
					/>
					<Textarea
						label="Instructions"
						description="Separate each instruction with a newline"
						name="instructions"
					/>
					<FileInput
						label="Images"
						name="images"
						multiple
						disabled={fileUploadNowAllowed}
						description={
							fileUploadNowAllowed &&
							"Please set the S3 variables required to enable file uploading"
						}
						accept="image/png,image/jpeg,image/jpg"
						leftSection={<IconPhoto />}
					/>
					<Button type="submit">Create</Button>
				</Stack>
			</Form>
		</Container>
	);
}
