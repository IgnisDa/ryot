// Test fakes implement only the members and overloads a test exercises.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters, typescript/no-unsafe-type-assertion
export const partialFake = <T extends object>(implementation: object): T => implementation as T;

export const derivedFake = <T extends object>(base: T, overrides: object): T => {
	const fake = { ...overrides };
	Reflect.setPrototypeOf(fake, base);
	return partialFake<T>(fake);
};
