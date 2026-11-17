import type { CompiledCatalog, CompiledElement, CompiledMessage } from "../catalog";

const accents: Readonly<Record<string, string>> = {
	A: "Å",
	B: "Ɓ",
	C: "Ç",
	D: "Đ",
	E: "É",
	F: "Ƒ",
	G: "Ĝ",
	H: "Ĥ",
	I: "Î",
	J: "Ĵ",
	K: "Ķ",
	L: "Ļ",
	M: "Ṁ",
	N: "Ñ",
	O: "Ö",
	P: "Þ",
	Q: "Ǫ",
	R: "Ŕ",
	S: "Š",
	T: "Ţ",
	U: "Û",
	V: "Ṽ",
	W: "Ŵ",
	X: "Ẋ",
	Y: "Ý",
	Z: "Ž",
	a: "å",
	b: "ƀ",
	c: "ç",
	d: "đ",
	e: "é",
	f: "ƒ",
	g: "ĝ",
	h: "ĥ",
	i: "î",
	j: "ĵ",
	k: "ķ",
	l: "ļ",
	m: "ɱ",
	n: "ñ",
	o: "ö",
	p: "þ",
	q: "ǫ",
	r: "ŕ",
	s: "š",
	t: "ţ",
	u: "û",
	v: "ṽ",
	w: "ŵ",
	x: "ẋ",
	y: "ý",
	z: "ž",
};

const VOWELS = new Set(["a", "e", "i", "o", "u", "A", "E", "I", "O", "U"]);

const pseudoText = (text: string) =>
	text.replaceAll(/[A-Za-z]/g, (character) => {
		const accented = accents[character] ?? character;
		return VOWELS.has(character) ? accented + accented : accented;
	});

const pseudoElements = (message: CompiledMessage): CompiledMessage =>
	message.map((element): CompiledElement => {
		if (element.type === 0) {
			return { type: 0, value: pseudoText(element.value) };
		}
		if (element.type === 5 || element.type === 6) {
			return {
				...element,
				options: Object.fromEntries(
					Object.entries(element.options).map(([selector, option]) => [
						selector,
						pseudoElements(option),
					]),
				),
			};
		}
		return element;
	});

/** Accents and lengthens literal text and brackets each message, keeping arguments intact. */
export const pseudoLocalizeCatalog = (catalog: CompiledCatalog): CompiledCatalog =>
	Object.fromEntries(
		Object.entries(catalog).map(([key, message]) => [
			key,
			[{ type: 0, value: "[" }, ...pseudoElements(message), { type: 0, value: "]" }],
		]),
	);
