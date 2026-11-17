import { PluginId } from "@ryot-app/contract/schema/brands";

export const MEDIA_OWNER_ID = PluginId.make("media-owner");

/** An entity schema name as the kernel serves it, stamped with the media owner's namespace. */
export const servedTypeName = (slug: string) => ({
	namespace: MEDIA_OWNER_ID,
	key: `entity-schema.${slug}.name`,
});

/** A provider name as the kernel serves it, stamped with the media owner's namespace. */
export const servedProviderName = (slug: string) => ({
	namespace: MEDIA_OWNER_ID,
	key: `provider.${slug}.name`,
});
