import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { strictStruct } from "../wire";
import { globalPropertiesSchema, nonEmptyString, sandboxIdSchema } from "./primitives";

export const createUserRelationshipSchema = strictStruct({
	sourceEntityId: sandboxIdSchema,
	targetEntityId: sandboxIdSchema,
	properties: globalPropertiesSchema,
	relationshipSchemaSlug: nonEmptyString,
	propertiesMode: Schema.Literals(["merge", "replace"]),
});
