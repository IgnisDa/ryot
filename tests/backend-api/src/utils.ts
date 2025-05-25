import { GraphQLClient } from "graphql-request";

export const getGraphqlClient = (baseUrl: string) => {
	return new GraphQLClient(`${baseUrl}/backend/graphql`);
};

export const getGraphqlClientHeaders = () => {
	return {
		Authorization: `Bearer ${process.env.USER_API_KEY}`,
	};
};
