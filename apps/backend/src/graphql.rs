use async_graphql::{Context, EmptySubscription, MergedObject, Object, Result, Schema};
use std::env;

#[derive(Default)]
struct CoreQuery;

#[Object]
impl CoreQuery {
    async fn version(&self, _gql_ctx: &Context<'_>) -> Result<String> {
        Ok(env!("CARGO_PKG_VERSION").to_owned())
    }
}

#[derive(Default)]
struct CoreMutation;

#[Object]
impl CoreMutation {
    async fn pass(&self, _gql_ctx: &Context<'_>) -> Result<bool> {
        Ok(true)
    }
}

#[derive(MergedObject, Default)]
pub struct QueryRoot(CoreQuery);

#[derive(MergedObject, Default)]
pub struct MutationRoot(CoreMutation);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;
