use std::{env, sync::Arc};

use async_graphql::{Context, EmptySubscription, MergedObject, Object, Schema, SimpleObject};
use serde::{Deserialize, Serialize};

use crate::{
    config::AppConfig,
    fitness::exercise::resolver::{ExerciseMutation, ExerciseQuery},
    importer::{ImporterMutation, ImporterQuery},
    miscellaneous::resolver::{MiscellaneousMutation, MiscellaneousQuery},
    utils::{AppServices, MemoryAuthDb},
    VERSION,
};

pub const AUTHOR: &str = "ignisda";
pub const PROJECT_NAME: &str = env!("CARGO_PKG_NAME");
pub const REPOSITORY_LINK: &str = "https://github.com/ignisda/ryot";
pub const USER_AGENT_STR: &str = const_str::concat!(AUTHOR, "/", PROJECT_NAME);

#[derive(SimpleObject)]
pub struct CoreDetails {
    version: String,
    author_name: String,
    repository_link: String,
    username_change_allowed: bool,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize)]
pub struct IdObject {
    pub id: i32,
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
    auth_db: MemoryAuthDb,
    config: Arc<AppConfig>,
) -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(config)
    .data(auth_db)
    .data(app_services.media_service.clone())
    .data(app_services.importer_service.clone())
    .data(app_services.exercise_service.clone())
    .finish()
}
