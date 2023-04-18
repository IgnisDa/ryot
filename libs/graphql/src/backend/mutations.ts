import { graphql } from "@trackona/generated/graphql/backend";

export const REGISTER_USER = graphql(`
  mutation RegisterUser($input: UserInput!) {
    registerUser(input: $input){
      __typename
      ... on RegisterError {
        error
      }
      ... on IdObject {
        id
      }
    }
  }
`);

export const LOGIN_USER = graphql(`
  mutation LoginUser($input: UserInput!) {
    loginUser(input: $input) {
      __typename
      ... on LoginError {
        error
      }
      ... on LoginResponse {
        apiKey
      }
    }
  }
`);
