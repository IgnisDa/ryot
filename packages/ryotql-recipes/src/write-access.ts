import { type WriteAccess, writeAccessFromScopes } from "@ryot-app/contract/oauth";

export const withWriteAccess = <Item extends { readonly scopes: readonly string[] }>({
	scopes,
	...item
}: Item): Omit<Item, "scopes"> & { readonly writeAccess: WriteAccess } => ({
	...item,
	writeAccess: writeAccessFromScopes(scopes),
});
