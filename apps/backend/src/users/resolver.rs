use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject, Union};
use chrono::Utc;
use cookie::{time::OffsetDateTime, Cookie};
use http::header::SET_COOKIE;
use sea_orm::{
    ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait, PaginatorTrait,
    QueryFilter,
};
use uuid::Uuid;

use crate::{
    entities::{
        prelude::{Token, User},
        token, user,
    },
    graphql::IdObject,
    migrator::{TokenLot, UserLot},
    GqlCtx,
};

pub static COOKIE_NAME: &str = "auth";

fn user_iden_from_ctx(ctx: &Context<'_>) -> Result<String> {
    let ctx = ctx.data_unchecked::<GqlCtx>();
    ctx.auth_token
        .clone()
        .ok_or_else(|| Error::new("The auth token is not present".to_owned()))
}

fn create_cookie(ctx: &Context<'_>, api_key: &str, expires: bool) -> Result<()> {
    let mut cookie = Cookie::build(COOKIE_NAME, api_key.to_string()).secure(true);
    if expires {
        cookie = cookie.expires(OffsetDateTime::now_utc());
    }
    let cookie = cookie.finish();
    ctx.insert_http_header(SET_COOKIE, cookie.to_string());
    Ok(())
}

fn get_hasher() -> Argon2<'static> {
    Argon2::default()
}

#[derive(Default)]
pub struct UsersMutation;

#[Object]
impl UsersMutation {
    /// Create a new user for the service. Also set their `lot` as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        input: UserInput,
    ) -> Result<RegisterResult> {
        gql_ctx
            .data_unchecked::<UsersService>()
            .register_user(&input.username, &input.password)
            .await
    }

    /// Login a user using their username and password and return an API key.
    async fn login_user(&self, gql_ctx: &Context<'_>, input: UserInput) -> Result<LoginResult> {
        let api_key = gql_ctx
            .data_unchecked::<UsersService>()
            .login_user(&input.username, &input.password)
            .await?;
        if let LoginResult::Ok(LoginResponse { api_key }) = api_key {
            create_cookie(gql_ctx, &api_key.to_string(), false)?;
        };
        Ok(api_key)
    }

    /// Logout a user from the server, deleting their login token
    async fn logout_user(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let user_id = user_iden_from_ctx(gql_ctx)?;
        create_cookie(gql_ctx, "", true)?;
        gql_ctx
            .data_unchecked::<UsersService>()
            .logout_user(&user_id)
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
        let password_hash = get_hasher()
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
        if get_hasher()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_err()
        {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::CredentialsMismatch,
            }));
        }
        let api_key = Uuid::new_v4();

        let token = token::ActiveModel {
            value: ActiveValue::Set(api_key.to_string()),
            lot: ActiveValue::Set(TokenLot::Login),
            user_id: ActiveValue::Set(user.id),
            last_used: ActiveValue::Set(Some(Utc::now())),
            ..Default::default()
        };
        Token::insert(token).exec(&self.db).await.unwrap();

        Ok(LoginResult::Ok(LoginResponse { api_key }))
    }

    async fn logout_user(&self, user_id: &str) -> Result<bool> {
        let token = Token::find()
            .filter(token::Column::Value.eq(user_id))
            .one(&self.db)
            .await?;
        if let Some(t) = token {
            t.delete(&self.db).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[derive(Debug, InputObject)]
struct UserInput {
    username: String,
    #[graphql(secret)]
    password: String,
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
