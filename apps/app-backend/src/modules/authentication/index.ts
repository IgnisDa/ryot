export {
	authenticationBuiltinEntitySchemas,
	authenticationBuiltinSavedViews,
	authenticationBuiltinTrackers,
	authenticationBuiltinRelationshipSchemas,
} from "./bootstrap/manifests";
export type { UserPreferences } from "./schemas";
export { defaultUserPreferences, userPreferencesSchema } from "./schemas";
export {
	buildAuthenticationSavedViewInputs,
	buildAuthenticationTrackerEntitySchemaLinks,
	buildAuthenticationTrackerInputs,
	buildLibraryEntityInput,
	resolveAuthenticationName,
} from "./service";
