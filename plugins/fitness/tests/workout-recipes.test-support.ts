import type { Filter } from "@ryot-app/contract/modules/filters/schemas";
import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { revisionDefinitions } from "@ryot-app/kernel-backend/modules/definitions/source";
import {
	compileControlFilter,
	resolveControl,
} from "@ryot-app/kernel-backend/modules/ryotql/controls";
import { PluginId } from "@ryot-app/plugin-kit/schema";
import type { Recipe } from "@ryot-app/ryotql";
import {
	bindRecipe,
	bindTestRequest,
	requireInlineDocument,
} from "@ryot-app/ryotql-recipes/test-utils";
import type { BindingContext } from "@ryot-app/ryotql/binding";
import { Result } from "effect";

import { fitnessPlugin } from "../manifest/plugin";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export const bindWorkoutRecipe = <Data, Parameters extends AppSchema>(
	recipe: Recipe<Data, Parameters>,
	argumentsValue: Readonly<Record<string, unknown>> = {},
	filter?: Filter,
	reference: PluginIdentityReference = { kind: "local", pluginId: PluginId.make("fitness-owner") },
) => {
	return bindRecipe(
		recipe,
		argumentsValue,
		workoutBindingContext(recipe.document, reference),
		filter === undefined ? {} : { filter },
	);
};

const workoutBindingContext = (
	document: RyotQLDocument,
	reference: PluginIdentityReference = { kind: "local", pluginId: PluginId.make("fitness-owner") },
): BindingContext => {
	const now = new Date("2026-10-18T00:00:00Z");
	return {
		now,
		reportingTimeZone: "UTC",
		filter: (name, target, value) => {
			const query = document.queries[name];
			if (query === undefined) {
				return Result.fail(new Error("Missing workout query"));
			}
			const pluginId = reference.kind === "local" ? reference.pluginId : "fitness-owner";
			return Result.flatMap(
				resolveControl(
					target,
					query,
					[
						{
							pluginId,
							slug: "workout",
							isEffective: true,
							pluginScope: "user",
							packageId: PLUGIN_PACKAGE_ID,
							browse:
								revisionDefinitions(pluginId, { ...fitnessPlugin, scripts: [] }).entitySchemas.find(
									(schema) => schema.slug === "workout",
								)?.browse ?? null,
						},
					],
					document,
				),
				(controls) => compileControlFilter(controls, query, value, now),
			);
		},
	};
};
export const bindWorkoutRequest = (request: ExecutionRequest) =>
	bindTestRequest(request, workoutBindingContext(requireInlineDocument(request)));
