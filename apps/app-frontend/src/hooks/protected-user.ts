import { getRouteApi } from "@tanstack/react-router";

const protectedRouteApi = getRouteApi("/_protected");

export function useProtectedUser() {
	return protectedRouteApi.useRouteContext({
		select: (context) => context.user,
	});
}
