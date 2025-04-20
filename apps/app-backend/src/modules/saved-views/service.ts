import { resolveRequiredString } from "@ryot/ts-utils";
import type { ServiceResult } from "~/lib/result";
import {
	createSavedViewForUser,
	deleteSavedViewByIdForUser,
	getSavedViewByIdForUser,
	updateSavedViewByIdForUser,
	updateSavedViewDisabledByIdForUser,
} from "./repository";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	UpdateSavedViewBody,
} from "./schemas";

const savedViewNotFoundError = "Saved view not found";
const builtinSavedViewError = "Cannot modify built-in saved views";

export type SavedViewServiceDeps = {
	createSavedViewForUser: typeof createSavedViewForUser;
	getSavedViewByIdForUser: typeof getSavedViewByIdForUser;
	deleteSavedViewByIdForUser: typeof deleteSavedViewByIdForUser;
	updateSavedViewByIdForUser: typeof updateSavedViewByIdForUser;
	updateSavedViewDisabledByIdForUser: typeof updateSavedViewDisabledByIdForUser;
};

export type SavedViewServiceResult<T> = ServiceResult<
	T,
	"builtin" | "not_found" | "validation"
>;

type SavedViewValidationResult<T> = ServiceResult<T, "validation">;

const savedViewServiceDeps: SavedViewServiceDeps = {
	createSavedViewForUser,
	deleteSavedViewByIdForUser,
	getSavedViewByIdForUser,
	updateSavedViewByIdForUser,
	updateSavedViewDisabledByIdForUser,
};

const createDataResult = <
	T,
	E extends string = "builtin" | "not_found" | "validation",
>(
	data: T,
): ServiceResult<T, E> => ({ data });

const createErrorResult = <T>(input: {
	error: "builtin" | "not_found" | "validation";
	message: string;
}): SavedViewServiceResult<T> => ({
	error: input.error,
	message: input.message,
});

const createValidationResult = <T>(
	message: string,
): SavedViewValidationResult<T> => ({
	message,
	error: "validation",
});

export const resolveSavedViewName = (name: string) =>
	resolveRequiredString(name, "Saved view name");

export const buildBuiltinSavedViewName = (entitySchemaName: string) =>
	`All ${entitySchemaName}s`;

const resolveSavedViewNameResult = (
	name: string,
	fallback: string,
): SavedViewValidationResult<string> => {
	try {
		return createDataResult<string, "validation">(resolveSavedViewName(name));
	} catch (error) {
		const message = error instanceof Error ? error.message : fallback;
		return createValidationResult(message);
	}
};

const resolveExistingSavedView = async (
	input: { userId: string; viewId: string },
	deps: SavedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingView = await deps.getSavedViewByIdForUser({
		viewId: input.viewId,
		userId: input.userId,
	});

	if (!existingView) {
		return createErrorResult({
			error: "not_found",
			message: savedViewNotFoundError,
		});
	}

	return createDataResult(existingView);
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
		return createErrorResult({
			error: "builtin",
			message: builtinSavedViewError,
		});
	}

	return existingViewResult;
};

const resolveMissingMutationResult = async (
	input: { userId: string; viewId: string },
	deps: SavedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const existingView = await deps.getSavedViewByIdForUser(input);
	if (existingView?.isBuiltin) {
		return createErrorResult({
			error: "builtin",
			message: builtinSavedViewError,
		});
	}

	return createErrorResult({
		error: "not_found",
		message: savedViewNotFoundError,
	});
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

	return createDataResult<ListedSavedView, "validation">(createdView);
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
			return createErrorResult({
				error: "not_found",
				message: savedViewNotFoundError,
			});
		}

		return createDataResult(updatedView);
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
	});

	if (!updatedView) {
		return resolveMissingMutationResult(
			{ viewId: input.viewId, userId: input.userId },
			deps,
		);
	}

	return createDataResult(updatedView);
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

	return createDataResult(deletedView);
};

export const cloneSavedView = async (
	input: { userId: string; viewId: string },
	deps: SavedViewServiceDeps = savedViewServiceDeps,
): Promise<SavedViewServiceResult<ListedSavedView>> => {
	const sourceView = await deps.getSavedViewByIdForUser(input);
	if (!sourceView) {
		return createErrorResult({
			error: "not_found",
			message: savedViewNotFoundError,
		});
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

	return createDataResult(clonedView);
};
