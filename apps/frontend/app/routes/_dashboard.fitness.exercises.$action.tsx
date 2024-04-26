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
	EditCustomExerciseDocument,
	ExerciseDetailsDocument,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
} from "@ryot/generated/graphql/backend/graphql";
import { cloneDeep, startCase } from "@ryot/ts-utils";
import { IconPhoto } from "@tabler/icons-react";
import { ClientError } from "graphql-request";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getCoreEnabledFeatures,
	gqlClient,
	processSubmission,
	s3FileUploader,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	name: z.string().optional(),
});

enum Action {
	Create = "create",
	Update = "update",
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
	const action = params.action as Action;
	const query = zx.parseQuery(request, searchParamsSchema);
	const details = await match(action)
		.with(Action.Create, () => undefined)
		.with(Action.Update, async () => {
			invariant(query.name, "Exercise name is required");
			const { exerciseDetails } = await gqlClient.request(
				ExerciseDetailsDocument,
				{ exerciseId: query.name },
			);
			return exerciseDetails;
		})
		.run();
	const [coreEnabledFeatures] = await Promise.all([getCoreEnabledFeatures()]);
	return json({
		action,
		details,
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
			instructions: instructions?.split("\n").map((s) => s.trim()) || [],
		},
	};
	return namedAction(request, {
		[Action.Create]: async () => {
			try {
				const { createCustomExercise } = await gqlClient.request(
					CreateCustomExerciseDocument,
					{ input },
					await getAuthorizationHeader(request),
				);
				return redirect(
					$path("/fitness/exercises/item/:id", { id: createCustomExercise }),
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
		},
		[Action.Update]: async () => {
			invariant(submission.oldName, "Old name is required");
			await gqlClient.request(
				EditCustomExerciseDocument,
				{ input: { ...input, oldName: submission.oldName } },
				await getAuthorizationHeader(request),
			);
			return redirect(
				$path("/fitness/exercises/item/:id", { id: submission.id }),
			);
		},
	});
};

const optionalString = z.string().optional();
const optionalStringArray = z.array(z.string()).optional();

const schema = z.object({
	oldName: optionalString,
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
	const title = startCase(loaderData.action);

	return (
		<Container>
			<Form
				method="post"
				replace
				encType="multipart/form-data"
				action={withQuery(".", { intent: loaderData.action })}
			>
				<Stack>
					<Title>{title} Exercise</Title>
					{loaderData.details?.id ? (
						<input
							type="hidden"
							name="oldName"
							defaultValue={loaderData.details.id}
						/>
					) : null}
					<TextInput
						label="Name"
						required
						autoFocus
						name="id"
						defaultValue={loaderData.details?.id}
					/>
					<Select
						label="Type"
						data={Object.values(ExerciseLot)}
						required
						name="lot"
						defaultValue={loaderData.details?.lot}
					/>
					<Group wrap="nowrap">
						<Select
							label="Level"
							data={Object.values(ExerciseLevel)}
							required
							name="level"
							w={{ base: "100%", md: "50%" }}
							defaultValue={loaderData.details?.level}
						/>
						<Select
							label="Force"
							data={Object.values(ExerciseForce)}
							name="force"
							w={{ base: "100%", md: "50%" }}
							defaultValue={loaderData.details?.force}
						/>
					</Group>
					<Group wrap="nowrap">
						<Select
							label="Equipment"
							data={Object.values(ExerciseEquipment)}
							name="equipment"
							w={{ base: "100%", md: "50%" }}
							defaultValue={loaderData.details?.equipment}
						/>
						<Select
							label="Mechanic"
							data={Object.values(ExerciseMechanic)}
							name="mechanic"
							w={{ base: "100%", md: "50%" }}
							defaultValue={loaderData.details?.mechanic}
						/>
					</Group>
					<MultiSelect
						label="Muscles"
						data={Object.values(ExerciseMuscle)}
						name="muscles"
						defaultValue={loaderData.details?.muscles}
					/>
					<Textarea
						label="Instructions"
						description="Separate each instruction with a newline"
						name="instructions"
						defaultValue={loaderData.details?.attributes.instructions.join(
							"\n",
						)}
						autosize
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
					<Button type="submit">{title}</Button>
				</Stack>
			</Form>
		</Container>
	);
}
