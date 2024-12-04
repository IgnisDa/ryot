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
	type MetaArgs,
	data,
	redirect,
	unstable_parseMultipartFormData,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	CreateCustomExerciseDocument,
	ExerciseDetailsDocument,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	UpdateCustomExerciseDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	cloneDeep,
	getActionIntent,
	processSubmission,
	startCase,
} from "@ryot/ts-utils";
import { IconPhoto } from "@tabler/icons-react";
import { ClientError } from "graphql-request";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { getExerciseDetailsPath } from "~/lib/generals";
import { useCoreDetails } from "~/lib/hooks";
import {
	createToastHeaders,
	s3FileUploader,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	name: z.string().optional(),
});

enum Action {
	Create = "create",
	Update = "update",
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
	const { action } = zx.parseParams(params, { action: z.nativeEnum(Action) });
	const query = zx.parseQuery(request, searchParamsSchema);
	const details = await match(action)
		.with(Action.Create, () => undefined)
		.with(Action.Update, async () => {
			invariant(query.name);
			const { exerciseDetails } = await serverGqlService.authenticatedRequest(
				request,
				ExerciseDetailsDocument,
				{ exerciseId: query.name },
			);
			return exerciseDetails;
		})
		.exhaustive();
	return { action, details };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Create Exercise | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const uploader = s3FileUploader("exercises");
	const formData = await unstable_parseMultipartFormData(
		request.clone(),
		uploader,
	);
	const submission = processSubmission(formData, schema);
	const muscles = submission.muscles
		? (submission.muscles.split(",") as Array<ExerciseMuscle>)
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
	try {
		const intent = getActionIntent(request);
		return await match(intent)
			.with(Action.Create, async () => {
				const { createCustomExercise } =
					await serverGqlService.authenticatedRequest(
						request,
						CreateCustomExerciseDocument,
						{ input },
					);
				return redirect(getExerciseDetailsPath(createCustomExercise));
			})
			.with(Action.Update, async () => {
				invariant(submission.oldName);
				await serverGqlService.authenticatedRequest(
					request,
					UpdateCustomExerciseDocument,
					{ input: { ...input, oldName: submission.oldName } },
				);
				return redirect($path("/fitness/exercises/list"));
			})
			.run();
	} catch (e) {
		if (e instanceof ClientError && e.response.errors) {
			const message = e.response.errors[0].message;
			return data(
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
	shouldDelete: zx.BoolAsString.optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;
	const title = startCase(loaderData.action);

	return (
		<Container>
			<Form
				replace
				method="POST"
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
					{!fileUploadNotAllowed ? (
						<FileInput
							label="Images"
							name="images"
							multiple
							description={
								loaderData.details &&
								"Please re-upload the images while updating the exercise, old ones will be deleted"
							}
							accept="image/png,image/jpeg,image/jpg"
							leftSection={<IconPhoto />}
						/>
					) : null}
					<Group w="100%" grow>
						{loaderData.details ? (
							<Button
								color="red"
								type="submit"
								name="shouldDelete"
								value="true"
							>
								Delete
							</Button>
						) : null}
						<Button type="submit">{title}</Button>
					</Group>
				</Stack>
			</Form>
		</Container>
	);
}
