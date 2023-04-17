use async_graphql::{Context, Error, Object, Result};
use scrypt::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Scrypt,
};
use sea_orm::{
    ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
};

use crate::{
    entities::{prelude::User, user},
    migrator::UserLot,
};

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
        #[graphql(secret)] password: String,
    ) -> Result<i32> {
        gql_ctx
            .data_unchecked::<UsersService>()
            .register_user(&username, &password)
            .await
    }
}

#[derive(Debug)]
pub struct UsersService {
    db: DatabaseConnection,
}

impl UsersService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl UsersService {
    async fn register_user(&self, username: &str, password: &str) -> Result<i32> {
        if User::find()
            .filter(user::Column::Name.eq(username))
            .count(&self.db)
            .await
            .unwrap()
            != 0
        {
            return Err(Error::new(
                "A user with this username already exists".to_owned(),
            ));
        };
        let salt = SaltString::generate(&mut OsRng);
        let password_hash = Scrypt
            .hash_password(password.as_bytes(), &salt)?
            .to_string();
        let lot = if User::find().count(&self.db).await.unwrap() == 0 {
            UserLot::Admin
        } else {
            UserLot::Normal
        };
        let user = user::ActiveModel {
            name: ActiveValue::Set(username.to_owned()),
            password: ActiveValue::Set(password_hash.to_owned()),
            lot: ActiveValue::Set(lot),
            ..Default::default()
        };
        let user = User::insert(user).exec(&self.db).await.unwrap();
        Ok(user.last_insert_id)
    }
}
