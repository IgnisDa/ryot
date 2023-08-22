use async_graphql::{Error, Result};
use sea_orm::{DatabaseConnection, EntityTrait};

use crate::entities::{prelude::User, user};

pub struct UsersService {
    db: DatabaseConnection,
}

impl UsersService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl UsersService {
    async fn user_by_id(&self, user_id: i32) -> Result<user::Model> {
        User::find_by_id(user_id)
            .one(&self.db)
            .await
            .unwrap()
            .ok_or_else(|| Error::new("No user found"))
    }
}
