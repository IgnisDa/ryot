import { resolveRequiredSlug } from "@ryot/ts-utils";
import type { CreateTrackerBody, UpdateTrackerBody } from "./schemas";

type TrackerState = {
	slug: string;
	name: string;
	icon: string;
	accentColor: string;
	description: string | null;
};

export const resolveTrackerSlug = (
	input: Pick<CreateTrackerBody, "name" | "slug">,
) => {
	return resolveRequiredSlug({
		name: input.name,
		label: "Tracker",
		slug: input.slug,
	});
};

export const resolveTrackerPatch = (input: {
	current: TrackerState;
	input: UpdateTrackerBody;
}) => {
	const name = input.input.name ?? input.current.name;

	return {
		name,
		slug: input.current.slug,
		icon:
			input.input.icon === undefined ? input.current.icon : input.input.icon,
		description:
			input.input.description === undefined
				? input.current.description
				: input.input.description,
		accentColor:
			input.input.accentColor === undefined
				? input.current.accentColor
				: input.input.accentColor,
	};
};

export const buildTrackerOrder = (input: {
	currentTrackerIds: string[];
	requestedTrackerIds: string[];
}) => {
	const requestedTrackerIds = [...new Set(input.requestedTrackerIds)];
	const requestedTrackerSet = new Set(requestedTrackerIds);
	const trailingTrackerIds = input.currentTrackerIds.filter(
		(trackerId) => !requestedTrackerSet.has(trackerId),
	);

	return [...requestedTrackerIds, ...trailingTrackerIds];
};
