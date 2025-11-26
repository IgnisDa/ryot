import { useMutation } from "@tanstack/react-query";
import type { DocumentNode } from "graphql";
import { useNavigate } from "react-router";
import invariant from "tiny-invariant";
import { mergeImages, uploadImages } from "../shared/image-utils";
import {
	showEntityError,
	showEntitySuccess,
} from "../shared/notification-utils";
import { clientGqlService, refreshEntityDetails } from "../shared/react-query";

export interface UseEntityCrudConfig<TValues, TDetails, TCreateResult> {
	s3Prefix: string;
	entityId?: string;
	entityName: string;
	action: "create" | "edit";
	createDocument: DocumentNode;
	updateDocument: DocumentNode;
	onSuccessCleanup?: () => void;
	detailsPath: (id: string) => string;
	extractIdFromUpdateResult: (result: unknown) => string;
	extractIdFromCreateResult: (result: TCreateResult) => string;
	transformToCreateInput: (values: TValues, s3Images: string[]) => unknown;
	useDetailsHook: (
		id?: string,
		enabled?: boolean,
	) => readonly [{ data?: TDetails }, ...unknown[]];
	transformToUpdateInput: (
		values: TValues,
		s3Images: string[],
		entityId: string,
	) => unknown;
}

export const useEntityCrud = <
	TValues extends {
		images: File[];
		existingImages: string[];
		id?: string;
		[key: string]: unknown;
	},
	TDetails,
	TCreateResult,
>(
	config: UseEntityCrudConfig<TValues, TDetails, TCreateResult>,
) => {
	const navigate = useNavigate();

	const [{ data: details }] = config.useDetailsHook(
		config.entityId,
		config.action === "edit" && Boolean(config.entityId),
	);

	const createMutation = useMutation({
		mutationFn: async (values: TValues) => {
			const s3Images = await uploadImages(values.images, config.s3Prefix);
			const input = config.transformToCreateInput(values, s3Images);
			const result = await clientGqlService.request<TCreateResult>(
				config.createDocument,
				{ input },
			);
			return config.extractIdFromCreateResult(result);
		},
		onSuccess: (id) => {
			showEntitySuccess(config.entityName, "created");
			config.onSuccessCleanup?.();
			navigate(config.detailsPath(id));
		},
		onError: () => {
			showEntityError(config.entityName, "create");
		},
	});

	const updateMutation = useMutation({
		mutationFn: async (values: TValues) => {
			invariant(config.entityId);
			const uploadedImages = await uploadImages(values.images, config.s3Prefix);
			const s3Images = mergeImages(values.existingImages, uploadedImages);
			const input = config.transformToUpdateInput(
				values,
				s3Images,
				config.entityId,
			);
			const result = await clientGqlService.request(config.updateDocument, {
				input,
			});
			return config.extractIdFromUpdateResult(result);
		},
		onSuccess: (id) => {
			refreshEntityDetails(id);
			showEntitySuccess(config.entityName, "updated");
			config.onSuccessCleanup?.();
			navigate(config.detailsPath(id));
		},
		onError: () => {
			showEntityError(config.entityName, "update");
		},
	});

	const handleSubmit = (values: TValues) => {
		if (config.action === "create") {
			createMutation.mutate(values);
		} else {
			updateMutation.mutate(values);
		}
	};

	return {
		details,
		handleSubmit,
		createMutation,
		updateMutation,
		isLoading: createMutation.isPending || updateMutation.isPending,
	};
};
