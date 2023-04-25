use async_graphql::{Context, Error, Result};
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult, QueryFilter, QuerySelect,
};

use crate::{
    entities::{prelude::Token, token},
    GqlCtx,
};

pub fn user_auth_token_from_ctx(ctx: &Context<'_>) -> Result<String> {
    let ctx = ctx.data_unchecked::<GqlCtx>();
    ctx.auth_token
        .clone()
        .ok_or_else(|| Error::new("The auth token is not present".to_owned()))
}

pub async fn user_id_from_ctx(ctx: &Context<'_>) -> Result<i32> {
    let db = ctx.data_unchecked::<DatabaseConnection>();
    let token = user_auth_token_from_ctx(ctx)?;
    #[derive(FromQueryResult)]
    struct Model {
        user_id: i32,
    }
    let found_token = Token::find()
        .select_only()
        .column(token::Column::UserId)
        .filter(token::Column::Value.eq(token))
        .into_model::<Model>()
        .one(db)
        .await
        .unwrap();
    match found_token {
        Some(t) => Ok(t.user_id),
        None => Err(Error::new("The auth token was incorrect")),
    }
}
