import { graphql } from "@trackona/generated/graphql/backend";

export const REGISTER_USER = graphql(`
  mutation RegisterUser($username: String!, $password: String!) {
    registerUser(username: $username, password: $password){
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
  mutation LoginUser($username: String!, $password: String!) {
    loginUser(username: $username, password: $password) {
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
