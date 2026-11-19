declare module "bun" {
	interface Env {
		readonly RYOT_VERSION?: string;
	}
}

// `bun build --define` only inlines the dotted member form.
export const RYOT_VERSION = process.env.RYOT_VERSION ?? "unknown";
