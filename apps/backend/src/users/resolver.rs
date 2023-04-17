use async_graphql::{Context, Enum, Object, Result, SimpleObject, Union};
use scrypt::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Scrypt,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait,
    QueryFilter, Set,
};
use uuid::Uuid;

use crate::{
    entities::{prelude::User, user},
    graphql::IdObject,
    migrator::{StringVec, UserLot},
};

#[derive(Default)]
pub struct UsersMutation;

#[Object]
impl UsersMutation {
    /// Create a new user for the service. Also set their `lot` as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        username: String,
        #[graphql(secret)] password: String,
    ) -> Result<RegisterResult> {
        gql_ctx
            .data_unchecked::<UsersService>()
            .register_user(&username, &password)
            .await
    }

    /// Login a user using their username and password and return an API key.
    async fn login_user(
        &self,
        gql_ctx: &Context<'_>,
        username: String,
        #[graphql(secret)] password: String,
    ) -> Result<LoginResult> {
        gql_ctx
            .data_unchecked::<UsersService>()
            .login_user(&username, &password)
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
    async fn register_user(&self, username: &str, password: &str) -> Result<RegisterResult> {
        if User::find()
            .filter(user::Column::Name.eq(username))
            .count(&self.db)
            .await
            .unwrap()
            != 0
        {
            return Ok(RegisterResult::Error(RegisterError {
                error: RegisterErrorVariant::UsernameAlreadyExists,
            }));
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
        Ok(RegisterResult::Ok(IdObject {
            id: user.last_insert_id,
        }))
    }

    async fn login_user(&self, username: &str, password: &str) -> Result<LoginResult> {
        let user = User::find()
            .filter(user::Column::Name.eq(username))
            .one(&self.db)
            .await
            .unwrap();
        if user.is_none() {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::UsernameDoesNotExist,
            }));
        };
        let user = user.unwrap();
        let parsed_hash = PasswordHash::new(&user.password).unwrap();
        if Scrypt
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_err()
        {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::CredentialsMismatch,
            }));
        }
        let api_key = Uuid::new_v4();
        let mut user: user::ActiveModel = user.into();
        let mut all_keys = user.api_keys.clone().unwrap().0;
        all_keys.push(api_key.to_string());
        user.api_keys = Set(StringVec(all_keys));
        user.update(&self.db).await.unwrap();
        Ok(LoginResult::Ok(LoginResponse { api_key }))
    }
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum RegisterErrorVariant {
    UsernameAlreadyExists,
}

#[derive(Debug, SimpleObject)]
struct RegisterError {
    error: RegisterErrorVariant,
}

#[derive(Union)]
enum RegisterResult {
    Ok(IdObject),
    Error(RegisterError),
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum LoginErrorVariant {
    UsernameDoesNotExist,
    CredentialsMismatch,
}

#[derive(Debug, SimpleObject)]
struct LoginError {
    error: LoginErrorVariant,
}

#[derive(Debug, SimpleObject)]
struct LoginResponse {
    api_key: Uuid,
}

#[derive(Union)]
enum LoginResult {
    Ok(LoginResponse),
    Error(LoginError),
}
