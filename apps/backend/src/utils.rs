use async_graphql::{Context, Error, Result};
use chrono::NaiveDate;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult, QueryFilter, QuerySelect,
};
use serde::{de, Deserialize, Serialize};
use surf::{
    http::headers::{AUTHORIZATION, USER_AGENT},
    Client, Config, Url,
};
use tokio::task::JoinSet;

use crate::{
    entities::{prelude::Token, token},
    graphql::AUTHOR,
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

pub async fn get_tmdb_config(url: &str, access_token: &str) -> (Client, String) {
    let client: Client = Config::new()
        .add_header(USER_AGENT, format!("{}/trackona", AUTHOR))
        .unwrap()
        .add_header(AUTHORIZATION, format!("Bearer {access_token}"))
        .unwrap()
        .set_base_url(Url::parse(url).unwrap())
        .try_into()
        .unwrap();
    #[derive(Debug, Serialize, Deserialize, Clone)]
    struct TmdbImageConfiguration {
        secure_base_url: String,
    }
    #[derive(Debug, Serialize, Deserialize, Clone)]
    struct TmdbConfiguration {
        images: TmdbImageConfiguration,
    }
    let mut rsp = client.get("configuration").await.unwrap();
    let data: TmdbConfiguration = rsp.body_json().await.unwrap();
    (client, data.images.secure_base_url)
}

pub fn convert_date_to_year(d: &str) -> Option<i32> {
    NaiveDate::parse_from_str(d, "%Y-%m-%d")
        .map(|d| d.format("%Y").to_string().parse::<i32>().unwrap())
        .ok()
}

pub async fn get_data_parallely_from_sources<'a, T, F, R>(
    iteree: &'a Vec<T>,
    client: &'a Client,
    get_url: F,
) -> Vec<R>
where
    F: Fn(&T) -> String,
    T: Send + Sync + de::DeserializeOwned + 'a + 'static,
    R: Send + Sync + de::DeserializeOwned + 'a + 'static,
{
    let mut set = JoinSet::new();
    for season in iteree.into_iter() {
        let client = client.clone();
        let url = get_url(season);
        set.spawn(async move {
            let mut rsp = client.get(url).await.unwrap();
            let season: R = rsp.body_json().await.unwrap();
            season
        });
    }
    let mut seasons = vec![];
    while let Some(Ok(result)) = set.join_next().await {
        seasons.push(result);
    }
    seasons
}
