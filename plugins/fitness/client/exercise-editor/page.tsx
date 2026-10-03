import { EntityEditor } from "@ryot-app/plugin-client-sdk/entity-editor";
import {
	usePluginLocation,
	usePluginParams,
	usePluginSearch,
} from "@ryot-app/plugin-client-sdk/plugin";
import { usePluginNavigation, useRyot } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";

import {
	exerciseEditorEntitySchemaSlug,
	exerciseEditorRelationshipSlugs,
	exerciseSaveInput,
	exerciseSaveOperationSlug,
	exerciseSaveOutput,
} from "../../shared/exercise-save-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export default function ExerciseEditorPage() {
	const client = useRyot();
	const navigation = usePluginNavigation();
	const params = usePluginParams();
	const search = usePluginSearch();
	const location = usePluginLocation();
	const exerciseId = params["exerciseId"];
	const seedEntityId = search.get("duplicate") ?? undefined;
	const initialName = search.get("name") ?? undefined;
	const editing = location.kind === "route" && exerciseId !== undefined;
	return (
		<PluginScreenFrame title={editing ? "Edit exercise" : "New exercise"}>
			<EntityEditor
				packageId={PLUGIN_PACKAGE_ID}
				onCancel={() => navigation.back()}
				entitySchemaSlug={exerciseEditorEntitySchemaSlug}
				relationshipSlugs={exerciseEditorRelationshipSlugs}
				onSaved={(entityId) => client.navigation.replace({ entityId, kind: "entity" })}
				save={(submission) =>
					client.operations.invoke({
						input: submission,
						output: exerciseSaveOutput,
						packageId: PLUGIN_PACKAGE_ID,
						inputSchema: exerciseSaveInput,
						slug: exerciseSaveOperationSlug,
					})
				}
				mode={
					editing
						? { kind: "edit", entityId: exerciseId }
						: {
								kind: "create",
								...(seedEntityId === undefined ? {} : { seedEntityId }),
								...(initialName === undefined ? {} : { initialName }),
							}
				}
			/>
		</PluginScreenFrame>
	);
}
