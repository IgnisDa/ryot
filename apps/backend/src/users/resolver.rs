use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use sea_orm::DatabaseConnection;

#[derive(Default)]
pub struct UsersMutation;

#[Object]
impl UsersMutation {
    /// Create a new user for the service. Also set their status as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        username: String,
        password: String,
    ) -> Result<bool> {
        gql_ctx
            .data_unchecked::<UsersService>()
            .register_user(&username, &password)
            .await
    }
}

#[derive(Debug)]
pub struct UsersService {
    db: Arc<DatabaseConnection>,
}

impl UsersService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self {
            db: Arc::new(db.clone()),
        }
    }
}

impl UsersService {
    async fn register_user(&self, username: &str, password: &str) -> Result<bool> {
        Ok(true)
    }
}
