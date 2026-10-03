declare module "bun" {
	interface Env {
		readonly UNKEY_ROOT_KEY?: string;
	}
}

// `bun build --define` only inlines the dotted member form.
export const UNKEY_ROOT_KEY = process.env.UNKEY_ROOT_KEY ?? "";
