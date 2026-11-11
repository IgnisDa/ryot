import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { LogRouteTemplate } from "../../http-annotations";
import {
	CheckClientPageFreshnessBody,
	CheckClientPageFreshnessResponse,
	ClientCompositionDocument,
	ClientCompositionDocumentBody,
	ClientPageDocumentStale,
	ClientPagePreparationError,
	CreatePageBody,
	PageAuthoringError,
	PageBuildResult,
	PageBundleFileNotFound,
	PageDraftResult,
	PageDraftRevisionBody,
	PageIdBody,
	PageMutationResult,
	PrepareClientPageBody,
	PreparedClientPage,
	ReplacePageDraftBody,
	SetPageWriteAccessBody,
} from "./schemas";

export const PageBundlesGroup = HttpApiGroup.make("pageBundles")
	.annotate(OpenApi.Description, "Serves immutable public or capability-protected client artifacts")
	.add(
		HttpApiEndpoint.get("file", "/page-bundles/:artifactHash/:accessKey/*", {
			error: [PageBundleFileNotFound.pipe(HttpApiSchema.status(404))],
			params: { "*": Schema.String, accessKey: Schema.String, artifactHash: Schema.String },
		})
			.annotate(LogRouteTemplate, true)
			.annotate(
				OpenApi.Description,
				"Serves one immutable file by artifact hash and public or capability access key",
			),
	);

export const PagesGroup = HttpApiGroup.make("pages")
	.annotate(OpenApi.Description, "Prepares client pages")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("prepare", "/pages/prepare", {
			success: PreparedClientPage,
			payload: PrepareClientPageBody,
			error: [ClientPagePreparationError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Resolves a client page and looks up its composition"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("checkFreshness", "/pages/freshness", {
			payload: CheckClientPageFreshnessBody,
			success: CheckClientPageFreshnessResponse,
		}).annotate(
			OpenApi.Description,
			"Checks whether a prepared page still matches current catalog state",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("document", "/pages/document", {
			success: ClientCompositionDocument,
			payload: ClientCompositionDocumentBody,
			error: [ClientPageDocumentStale.pipe(HttpApiSchema.status(409))],
		}).annotate(
			OpenApi.Description,
			"Generates the composition document for a prepared page that still matches current catalog state",
		),
	)
	.middleware(AuthMiddleware);

export const PageAuthoringGroup = HttpApiGroup.make("pageAuthoring")
	.annotate(OpenApi.Description, "Authors, compiles and publishes user-owned client pages")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("create", "/pages", {
			payload: CreatePageBody,
			success: PageDraftResult,
			error: [PageAuthoringError.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates an owned page with its initial source draft"),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")("replaceDraft", "/pages/draft", {
			success: PageDraftResult,
			payload: ReplacePageDraftBody,
			error: [PageAuthoringError.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Replaces a page draft at the expected draft revision"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("compile", "/pages/compile", {
			success: PageBuildResult,
			payload: PageDraftRevisionBody,
			error: [PageAuthoringError.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Compiles the current page draft for preview"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("publish", "/pages/publish", {
			success: PageBuildResult,
			payload: PageDraftRevisionBody,
			error: [PageAuthoringError.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Compiles and publishes the current page draft"),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")("setWriteAccess", "/pages/write-access", {
			success: PageMutationResult,
			payload: SetPageWriteAccessBody,
			error: [PageAuthoringError.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Updates write authority for an owned page"),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")("delete", "/pages", {
			payload: PageIdBody,
			success: PageMutationResult,
			error: [PageAuthoringError.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Deletes an owned page when no saved views reference it"),
	)
	.middleware(AuthMiddleware);
