import { resolveRequiredString } from "@ryot/ts-utils";
import { buildReorderedIds } from "~/lib/reorder";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import {
	countSavedViewsByIdsForUser,
	createSavedViewForUser,
	deleteSavedViewByIdForUser,
	getSavedViewByIdForUser,
	listUserSavedViewIdsInOrder,
	persistSavedViewOrderForUser,
	updateSavedViewByIdForUser,
	updateSavedViewDisabledByIdForUser,
} from "./repository";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "./schemas";

const savedViewNotFoundError = "Saved view not found";
const builtinSavedViewError = "Cannot modify built-in saved views";
const savedViewIdsUnknownError = "Saved view ids contain unknown saved views";

export type SavedViewServiceDeps = {
	createSavedViewForUser: typeof createSavedViewForUser;
	getSavedViewByIdForUser: typeof getSavedViewByIdForUser;
	deleteSavedViewByIdForUser: typeof deleteSavedViewByIdForUser;
	updateSavedViewByIdForUser: typeof updateSavedViewByIdForUser;
	countSavedViewsByIdsForUser: typeof countSavedViewsByIdsForUser;
	listUserSavedViewIdsInOrder: typeof listUserSavedViewIdsInOrder;
	persistSavedViewOrderForUser: typeof persistSavedViewOrderForUser;
	updateSavedViewDisabledByIdForUser: typeof updateSavedViewDisabledByIdForUser;
};

export type SavedViewServiceResult<T> = ServiceResult<
	T,
	"builtin" | "not_found" | "validation"
>;

type SavedViewValidationResult<T> = ServiceResult<T, "validation">;

const savedViewServiceDeps: SavedViewServiceDeps = {
	createSavedViewForUser,
	countSavedViewsByIdsForUser,
	deleteSavedViewByIdForUser,
	getSavedViewByIdForUser,
	listUserSavedViewIdsInOrder,
	persistSavedViewOrderForUser,
	updateSavedViewByIdForUser,
	updateSavedViewDisabledByIdForUser,
};

export const resolveSavedViewName = (name: string) =>
	resolveRequiredString(name, "Saved view name");

export const buildBuiltinSavedViewName = (entitySchemaName: string) =>
	`All ${entitySchemaName}s`;

const resolveSavedViewNameResult = (name: string, fallback: string) =>
	wrapServiceValidator(() => resolveSavedViewName(name), fallback);

const resolveExistingSavedView = async (
	input: { userId: string; viewId: string },
	deps: SavedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingView = await deps.getSavedViewByIdForUser({
		viewId: input.viewId,
		userId: input.userId,
	});

	if (!existingView) {
		return serviceError("not_found", savedViewNotFoundError);
	}

	return serviceData(existingView);
};

const resolveMutableSavedView = async (
	input: { userId: string; viewId: string },
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
	input: { userId: string; viewId: string },
	deps: SavedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingView = await deps.getSavedViewByIdForUser(input);
	if (existingView?.isBuiltin) {
		return serviceError("builtin", builtinSavedViewError);
	}

	return serviceError("not_found", savedViewNotFoundError);
};

const buildClonedSavedViewName = (name: string) => `${name} (Copy)`;

export const createSavedView = async (
	input: { body: CreateSavedViewBody; userId: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewValidationResult<ListedSavedView>> => {
	const nameResult = resolveSavedViewNameResult(
		input.body.name,
		"Saved view name is invalid",
	);
	if ("error" in nameResult) {
		return nameResult;
	}

	const createdView = await deps.createSavedViewForUser({
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
};

export const updateSavedView = async (
	input: { body: UpdateSavedViewBody; userId: string; viewId: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingViewResult = await resolveExistingSavedView(
		{ viewId: input.viewId, userId: input.userId },
		deps,
	);
	if ("error" in existingViewResult) {
		return existingViewResult;
	}

	if (existingViewResult.data.isBuiltin) {
		const updatedView = await deps.updateSavedViewDisabledByIdForUser({
			userId: input.userId,
			viewId: input.viewId,
			isDisabled: input.body.isDisabled,
		});

		if (!updatedView) {
			return serviceError("not_found", savedViewNotFoundError);
		}

		return serviceData(updatedView);
	}

	const nameResult = resolveSavedViewNameResult(
		input.body.name,
		"Saved view name is invalid",
	);
	if ("error" in nameResult) {
		return nameResult;
	}

	const updatedView = await deps.updateSavedViewByIdForUser({
		viewId: input.viewId,
		userId: input.userId,
		data: { ...input.body, name: nameResult.data },
		currentTrackerId: existingViewResult.data.trackerId,
	});

	if (!updatedView) {
		return resolveMissingMutationResult(
			{ viewId: input.viewId, userId: input.userId },
			deps,
		);
	}

	return serviceData(updatedView);
};

export const deleteSavedView = async (
	input: { userId: string; viewId: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingViewResult = await resolveMutableSavedView(input, deps);
	if ("error" in existingViewResult) {
		return existingViewResult;
	}

	const deletedView = await deps.deleteSavedViewByIdForUser(input);
	if (!deletedView) {
		return resolveMissingMutationResult(input, deps);
	}

	return serviceData(deletedView);
};

export const cloneSavedView = async (
	input: { userId: string; viewId: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const sourceView = await deps.getSavedViewByIdForUser(input);
	if (!sourceView) {
		return serviceError("not_found", savedViewNotFoundError);
	}

	const clonedNameResult = resolveSavedViewNameResult(
		buildClonedSavedViewName(sourceView.name),
		"Cloned view name is invalid",
	);
	if ("error" in clonedNameResult) {
		return clonedNameResult;
	}

	const clonedView = await deps.createSavedViewForUser({
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
};

export const reorderSavedViews = async (
	input: { body: ReorderSavedViewsBody; userId: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewValidationResult<{ viewIds: string[] }>> => {
	const savedViewCount = await deps.countSavedViewsByIdsForUser({
		userId: input.userId,
		viewIds: input.body.viewIds,
		trackerId: input.body.trackerId,
	});
	if (savedViewCount !== input.body.viewIds.length) {
		return serviceError("validation", savedViewIdsUnknownError);
	}

	const currentViewIds = await deps.listUserSavedViewIdsInOrder({
		userId: input.userId,
		trackerId: input.body.trackerId,
	});
	const viewIds = await deps.persistSavedViewOrderForUser({
		userId: input.userId,
		trackerId: input.body.trackerId,
		viewIds: buildReorderedIds({
			currentIds: currentViewIds,
			requestedIds: input.body.viewIds,
		}),
	});
	if (!viewIds || viewIds.length !== currentViewIds.length) {
		return serviceError("validation", savedViewIdsUnknownError);
	}

	return serviceData({ viewIds });
};
