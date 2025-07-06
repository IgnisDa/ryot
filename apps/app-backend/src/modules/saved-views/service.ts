import { isEqual, resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";

import { isUniqueConstraintError } from "~/lib/app/postgres";
import { buildReorderedIds } from "~/lib/reorder";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";
import { prepareForValidation } from "~/modules/query-engine";

import {
	countSavedViewsBySlugForUser,
	createSavedViewForUser,
	deleteSavedViewBySlugForUser,
	getSavedViewBySlugForUser,
	listUserSavedViewSlugsInOrder,
	persistSavedViewOrderForUser,
	updateSavedViewBySlugForUser,
	updateSavedViewDisabledBySlugForUser,
} from "./repository";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "./schemas";

const savedViewNotFoundError = "Saved view not found";
const builtinSavedViewError = "Cannot modify built-in saved views";
const savedViewSlugsUnknownError = "Saved view slugs contain unknown saved views";
const duplicateSavedViewSlugError = "A saved view with this name already exists";
const savedViewSlugConstraint = "saved_view_user_slug_unique";

type PrepareSavedViewValidationInput = Pick<
	CreateSavedViewBody,
	"displayConfiguration" | "queryDefinition"
> & {
	userId: string;
};

type PrepareForValidation = (input: PrepareSavedViewValidationInput) => Promise<void>;

export type SavedViewServiceDeps = {
	prepareForValidation: PrepareForValidation;
	createSavedViewForUser: typeof createSavedViewForUser;
	getSavedViewBySlugForUser: typeof getSavedViewBySlugForUser;
	deleteSavedViewBySlugForUser: typeof deleteSavedViewBySlugForUser;
	updateSavedViewBySlugForUser: typeof updateSavedViewBySlugForUser;
	countSavedViewsBySlugForUser: typeof countSavedViewsBySlugForUser;
	listUserSavedViewSlugsInOrder: typeof listUserSavedViewSlugsInOrder;
	persistSavedViewOrderForUser: typeof persistSavedViewOrderForUser;
	updateSavedViewDisabledBySlugForUser: typeof updateSavedViewDisabledBySlugForUser;
};

export type SavedViewServiceResult<T> = ServiceResult<T, "builtin" | "not_found" | "validation">;

type SavedViewValidationResult<T> = ServiceResult<T, "validation">;

const savedViewServiceDeps: SavedViewServiceDeps = {
	prepareForValidation,
	createSavedViewForUser,
	getSavedViewBySlugForUser,
	countSavedViewsBySlugForUser,
	deleteSavedViewBySlugForUser,
	persistSavedViewOrderForUser,
	updateSavedViewBySlugForUser,
	listUserSavedViewSlugsInOrder,
	updateSavedViewDisabledBySlugForUser,
};

export const resolveSavedViewName = (name: string) =>
	resolveRequiredString(name, "Saved view name");

export const buildBuiltinSavedViewName = (entitySchemaName: string) => `All ${entitySchemaName}s`;

const resolveSavedViewNameResult = (name: string, fallback: string) =>
	wrapServiceValidator(() => resolveSavedViewName(name), fallback);

const resolveExistingSavedView = async (
	input: { userId: string; viewSlug: string },
	deps: SavedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingView = await deps.getSavedViewBySlugForUser({
		userId: input.userId,
		viewSlug: input.viewSlug,
	});

	if (!existingView) {
		return serviceError("not_found", savedViewNotFoundError);
	}

	return serviceData(existingView);
};

const resolveMutableSavedView = async (
	input: { userId: string; viewSlug: string },
	deps: SavedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingViewResult = await resolveExistingSavedView(input, deps);
	if ("error" in existingViewResult) {
		return existingViewResult;
	}

	if (existingViewResult.data.isBuiltin) {
		return serviceError("builtin", builtinSavedViewError);
	}

	return existingViewResult;
};

const resolveMissingMutationResult = async (
	input: { userId: string; viewSlug: string },
	deps: SavedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingView = await deps.getSavedViewBySlugForUser(input);
	if (existingView?.isBuiltin) {
		return serviceError("builtin", builtinSavedViewError);
	}

	return serviceError("not_found", savedViewNotFoundError);
};

const buildClonedSavedViewName = (name: string) => `${name} (Copy)`;

const mapValidationErrorResult = (error: unknown) => {
	if (error instanceof QueryEngineNotFoundError || error instanceof QueryEngineValidationError) {
		return serviceError("validation", error.message);
	}

	throw error;
};

const ensureBuiltinUpdateIsAllowed = (
	currentView: ListedSavedView,
	body: UpdateSavedViewBody,
): Extract<SavedViewValidationResult<never>, { error: "validation" }> | undefined => {
	if (!currentView.isBuiltin) {
		return;
	}

	const nextName = body.name ?? currentView.name;
	const nextIcon = body.icon ?? currentView.icon;
	const nextTrackerId = body.trackerId ?? currentView.trackerId ?? undefined;
	const nextAccentColor = body.accentColor ?? currentView.accentColor;
	const nextQueryDefinition = body.queryDefinition ?? currentView.queryDefinition;
	const nextDisplayConfiguration = body.displayConfiguration ?? currentView.displayConfiguration;
	const currentTrackerId = currentView.trackerId ?? undefined;

	const attemptsMutation =
		nextName !== currentView.name ||
		nextIcon !== currentView.icon ||
		nextTrackerId !== currentTrackerId ||
		nextAccentColor !== currentView.accentColor ||
		!isEqual(nextQueryDefinition, currentView.queryDefinition) ||
		!isEqual(nextDisplayConfiguration, currentView.displayConfiguration);

	if (attemptsMutation) {
		return serviceError("validation", builtinSavedViewError);
	}
};
const validateDefinition = async (
	input: Pick<CreateSavedViewBody, "displayConfiguration" | "queryDefinition"> & { userId: string },
	deps: SavedViewServiceDeps,
): Promise<Extract<SavedViewValidationResult<never>, { error: "validation" }> | undefined> => {
	try {
		await deps.prepareForValidation({
			displayConfiguration: input.displayConfiguration,
			queryDefinition: input.queryDefinition,
			userId: input.userId,
		});
	} catch (error) {
		return mapValidationErrorResult(error);
	}
};

export const createSavedView = async (
	input: { body: CreateSavedViewBody; userId: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewValidationResult<ListedSavedView>> => {
	const nameResult = resolveSavedViewNameResult(input.body.name, "Saved view name is invalid");
	if ("error" in nameResult) {
		return nameResult;
	}

	const validationResult = await validateDefinition(
		{
			displayConfiguration: input.body.displayConfiguration,
			queryDefinition: input.body.queryDefinition,
			userId: input.userId,
		},
		deps,
	);
	if (validationResult) {
		return validationResult;
	}

	const slug = resolveRequiredSlug({
		label: "Saved view",
		name: nameResult.data,
	});

	try {
		const createdView = await deps.createSavedViewForUser({
			slug,
			isBuiltin: false,
			userId: input.userId,
			icon: input.body.icon,
			name: nameResult.data,
			trackerId: input.body.trackerId,
			accentColor: input.body.accentColor,
			queryDefinition: input.body.queryDefinition,
			displayConfiguration: input.body.displayConfiguration,
		});

		return serviceData(createdView);
	} catch (error) {
		if (isUniqueConstraintError(error, savedViewSlugConstraint)) {
			return serviceError("validation", duplicateSavedViewSlugError);
		}
		throw error;
	}
};

export const updateSavedView = async (
	input: { body: UpdateSavedViewBody; userId: string; viewSlug: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingViewResult = await resolveExistingSavedView(
		{ viewSlug: input.viewSlug, userId: input.userId },
		deps,
	);
	if ("error" in existingViewResult) {
		return existingViewResult;
	}

	if (existingViewResult.data.isBuiltin) {
		const builtinMutationResult = ensureBuiltinUpdateIsAllowed(existingViewResult.data, input.body);
		if (builtinMutationResult) {
			return builtinMutationResult;
		}

		const updatedView = await deps.updateSavedViewDisabledBySlugForUser({
			userId: input.userId,
			viewSlug: input.viewSlug,
			isDisabled: input.body.isDisabled,
		});

		if (!updatedView) {
			return serviceError("not_found", savedViewNotFoundError);
		}

		return serviceData(updatedView);
	}

	const nameResult = resolveSavedViewNameResult(input.body.name, "Saved view name is invalid");
	if ("error" in nameResult) {
		return nameResult;
	}

	const validationResult = await validateDefinition(
		{
			displayConfiguration: input.body.displayConfiguration,
			queryDefinition: input.body.queryDefinition,
			userId: input.userId,
		},
		deps,
	);
	if (validationResult) {
		return validationResult;
	}

	const updatedView = await deps.updateSavedViewBySlugForUser({
		viewSlug: input.viewSlug,
		userId: input.userId,
		data: { ...input.body, name: nameResult.data },
		currentTrackerId: existingViewResult.data.trackerId,
	});

	if (!updatedView) {
		return resolveMissingMutationResult({ viewSlug: input.viewSlug, userId: input.userId }, deps);
	}

	return serviceData(updatedView);
};

export const deleteSavedView = async (
	input: { userId: string; viewSlug: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingViewResult = await resolveMutableSavedView(input, deps);
	if ("error" in existingViewResult) {
		return existingViewResult;
	}

	const deletedView = await deps.deleteSavedViewBySlugForUser(input);
	if (!deletedView) {
		return resolveMissingMutationResult(input, deps);
	}

	return serviceData(deletedView);
};

export const cloneSavedView = async (
	input: { userId: string; viewSlug: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const sourceView = await deps.getSavedViewBySlugForUser(input);
	if (!sourceView) {
		return serviceError("not_found", savedViewNotFoundError);
	}

	const clonedName = buildClonedSavedViewName(sourceView.name);
	const clonedNameResult = resolveSavedViewNameResult(clonedName, "Cloned view name is invalid");
	if ("error" in clonedNameResult) {
		return clonedNameResult;
	}

	const validationResult = await validateDefinition(
		{
			displayConfiguration: sourceView.displayConfiguration,
			queryDefinition: sourceView.queryDefinition,
			userId: input.userId,
		},
		deps,
	);
	if (validationResult) {
		return validationResult;
	}

	const cloneSlug = resolveRequiredSlug({
		label: "Cloned saved view",
		name: clonedNameResult.data,
	});

	try {
		const clonedView = await deps.createSavedViewForUser({
			slug: cloneSlug,
			isBuiltin: false,
			userId: input.userId,
			icon: sourceView.icon,
			name: clonedNameResult.data,
			accentColor: sourceView.accentColor,
			queryDefinition: sourceView.queryDefinition,
			trackerId: sourceView.trackerId ?? undefined,
			displayConfiguration: sourceView.displayConfiguration,
		});

		return serviceData(clonedView);
	} catch (error) {
		if (isUniqueConstraintError(error, savedViewSlugConstraint)) {
			return serviceError("validation", duplicateSavedViewSlugError);
		}
		throw error;
	}
};

export const reorderSavedViews = async (
	input: { body: ReorderSavedViewsBody; userId: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewValidationResult<{ viewSlugs: string[] }>> => {
	const savedViewCount = await deps.countSavedViewsBySlugForUser({
		userId: input.userId,
		viewSlugs: input.body.viewSlugs,
		trackerId: input.body.trackerId,
	});
	if (savedViewCount !== input.body.viewSlugs.length) {
		return serviceError("validation", savedViewSlugsUnknownError);
	}

	const currentViewSlugs = await deps.listUserSavedViewSlugsInOrder({
		userId: input.userId,
		trackerId: input.body.trackerId,
	});
	const viewSlugs = await deps.persistSavedViewOrderForUser({
		userId: input.userId,
		trackerId: input.body.trackerId,
		viewSlugs: buildReorderedIds({
			currentIds: currentViewSlugs,
			requestedIds: input.body.viewSlugs,
		}),
	});
	if (!viewSlugs || viewSlugs.length !== currentViewSlugs.length) {
		return serviceError("validation", savedViewSlugsUnknownError);
	}

	return serviceData({ viewSlugs });
};
