declare module "*.css";

declare module "*.png" {
	const source: string;
	export default source;
}

declare module "*.svg" {
	const source: string;
	export default source;
}
