declare module "@babel/plugin-syntax-jsx" {
	const plugin: object;
	export default plugin;
}

declare module "@babel/plugin-syntax-typescript" {
	const plugin: object;
	export default plugin;
}

declare module "jsdom" {
	type DOMWindow = Window & typeof globalThis & { readonly document: Document; close: () => void };

	export class JSDOM {
		constructor(source?: string, options?: { readonly url?: string });
		readonly window: DOMWindow;
	}
}
