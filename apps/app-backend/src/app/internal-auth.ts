export type InternalRequestAuth = { userId: string };

const internalRequestAuthRegistry = new WeakMap<Request, InternalRequestAuth>();

export const getInternalRequestAuth = (request: Request) =>
	internalRequestAuthRegistry.get(request) ?? null;

export const setInternalRequestAuth = (
	request: Request,
	auth: InternalRequestAuth,
) => {
	internalRequestAuthRegistry.set(request, auth);
	return request;
};
