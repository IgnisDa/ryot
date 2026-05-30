import type { Client } from "~/fixtures/kernel/auth";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";

export const findBuiltinSchemaWithProviders = (client: Client) =>
	findBuiltinSchemaBySlug(client, "book");
