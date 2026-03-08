import { resolveRequiredString } from "@ryot/ts-utils";

export const resolveSavedViewName = (name: string) =>
	resolveRequiredString(name, "Saved view name");

export const buildBuiltinSavedViewName = (entitySchemaName: string) =>
	`All ${entitySchemaName}s`;

export const resolveIsBuiltinProtected = (isBuiltin: boolean) => {
	return isBuiltin ? { protected: true } : { protected: false };
};
