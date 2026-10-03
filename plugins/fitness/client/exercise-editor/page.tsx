import { EntityEditorScreen } from "@ryot-app/plugin-client-sdk/entity-editor";
import {
	usePluginLocation,
	usePluginParams,
	usePluginSearch,
} from "@ryot-app/plugin-client-sdk/plugin";

import { exerciseEditors, exerciseSaveOperationSlug } from "../../shared/exercise-save-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export default function ExerciseEditorPage() {
	const params = usePluginParams();
	const search = usePluginSearch();
	const location = usePluginLocation();
	const exerciseId = params["exerciseId"];
	const seedEntityId = search.get("duplicate") ?? undefined;
	const initialName = search.get("name") ?? undefined;
	const editing = location.kind === "route" && exerciseId !== undefined;
	return (
		<EntityEditorScreen
			entitySchemaSlug="exercise"
			packageId={PLUGIN_PACKAGE_ID}
			relationshipSlugs={exerciseEditors.exercise}
			saveOperationSlug={exerciseSaveOperationSlug}
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
	);
}
