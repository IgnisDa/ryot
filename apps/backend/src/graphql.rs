use std::{env, sync::Arc};

use async_graphql::{
    scalar, Context, EmptySubscription, MergedObject, Object, Schema, SimpleObject,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

use crate::{
    config::AppConfig,
    fitness::exercise::resolver::{ExerciseMutation, ExerciseQuery},
    importer::{ImporterMutation, ImporterQuery},
    miscellaneous::resolver::{MiscellaneousMutation, MiscellaneousQuery},
    utils::{AppServices, MemoryDb},
    VERSION,
};

pub const AUTHOR: &str = "ignisda";
pub const PROJECT_NAME: &str = env!("CARGO_PKG_NAME");
pub const REPOSITORY_LINK: &str = "https://github.com/ignisda/ryot";
pub const USER_AGENT_STR: &str = const_str::concat!(AUTHOR, "/", PROJECT_NAME);

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct Identifier(i32);

impl From<Identifier> for i32 {
    fn from(value: Identifier) -> Self {
        value.0
    }
}

impl From<i32> for Identifier {
    fn from(value: i32) -> Self {
        Self(value)
    }
}

scalar!(Identifier);

#[derive(SimpleObject)]
pub struct CoreDetails {
    version: String,
    author_name: String,
    repository_link: String,
    username_change_allowed: bool,
}

#[derive(Debug, SimpleObject)]
pub struct IdObject {
    pub id: Identifier,
}

#[derive(Default)]
struct CoreQuery;

#[Object]
impl CoreQuery {
    /// Get some primary information about the service
    async fn core_details(&self, gql_ctx: &Context<'_>) -> CoreDetails {
        let config = gql_ctx.data_unchecked::<Arc<AppConfig>>();
        CoreDetails {
            version: VERSION.to_owned(),
            author_name: AUTHOR.to_owned(),
            repository_link: REPOSITORY_LINK.to_owned(),
            username_change_allowed: config.users.allow_changing_username,
        }
    }
}

#[derive(MergedObject, Default)]
pub struct QueryRoot(CoreQuery, MiscellaneousQuery, ImporterQuery, ExerciseQuery);

#[derive(MergedObject, Default)]
pub struct MutationRoot(MiscellaneousMutation, ImporterMutation, ExerciseMutation);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(
    app_services: &AppServices,
    db: DatabaseConnection,
    scdb: MemoryDb,
    config: Arc<AppConfig>,
) -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(config)
    .data(db)
    .data(scdb)
    .data(app_services.media_service.clone())
    .data(app_services.importer_service.clone())
    .data(app_services.exercise_service.clone())
    .finish()
}
