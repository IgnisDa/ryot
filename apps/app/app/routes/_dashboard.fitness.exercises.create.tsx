import { Box, Container } from "@mantine/core";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
	redirect,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	CreateCustomExerciseDocument,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseSource,
} from "@ryot/generated/graphql/backend/graphql";
import { $path } from "remix-routes";
import { z } from "zod";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreEnabledFeatures } from "~/lib/graphql.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async (_args: LoaderFunctionArgs) => {
	const [coreEnabledFeatures] = await Promise.all([getCoreEnabledFeatures()]);
	return json({ coreEnabledFeatures });
};

export const meta: MetaFunction = () => {
	return [{ title: "Create Exercise | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	const submission = processSubmission(formData, schema);
	const muscles = submission.muscles;
	const instructions = submission.instructions;
	const input = Object.assign(submission, {});
	input.muscles = undefined;
	input.instructions = undefined;
	const { createCustomExercise } = await gqlClient.request(
		CreateCustomExerciseDocument,
		{
			input: {
				source: ExerciseSource.Custom,
				...input,
				muscles: muscles || [],
				attributes: {
					images: JSON.parse(submission.images || "[]"),
					instructions: instructions?.split("\n") || [],
				},
			},
		},
		await getAuthorizationHeader(request),
	);
	return redirect($path("/media/item/:id", { id: createCustomExercise }));
};

const optionalString = z.string().optional();

const schema = z.object({
	id: z.string(),
	lot: z.nativeEnum(ExerciseLot),
	level: z.nativeEnum(ExerciseLevel),
	force: z.nativeEnum(ExerciseForce).optional(),
	mechanic: z.nativeEnum(ExerciseMechanic).optional(),
	equipment: z.nativeEnum(ExerciseEquipment).optional(),
	muscles: z.nativeEnum(ExerciseMuscle).array().optional(),
	instructions: optionalString,
	images: optionalString,
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
