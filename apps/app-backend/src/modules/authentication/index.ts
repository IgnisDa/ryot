export {
	authenticationBuiltinEntitySchemas,
	authenticationBuiltinSavedViews,
	authenticationBuiltinTrackers,
	authenticationBuiltinRelationshipSchemas,
} from "./bootstrap/manifests";
export { bootstrapNewUser } from "./bootstrap/sign-up";
export type { UserPreferences } from "./schemas";
export { defaultUserPreferences, userPreferencesSchema } from "./schemas";
export {
	buildAuthenticationSavedViewInputs,
	buildAuthenticationTrackerEntitySchemaLinks,
	buildLibraryEntityInput,
} from "./service";
