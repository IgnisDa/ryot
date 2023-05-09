use async_graphql::{Context, Error, InputObject, Result, SimpleObject};
use chrono::NaiveDate;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult, QueryFilter, QuerySelect,
};
use serde::de;
use serde::{Deserialize, Serialize};
use surf::{
    http::headers::{AUTHORIZATION, USER_AGENT},
    Client, Config, Url,
};
use tokio::task::JoinSet;

use crate::graphql::AUTHOR;

use crate::{
    entities::{prelude::Token, token},
    GqlCtx,
};

#[derive(Debug, Serialize, Deserialize, Clone, SimpleObject, InputObject)]
#[graphql(input_name = "NamedObjectInput")]
pub struct NamedObject {
    pub name: String,
}

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

pub fn convert_string_to_date(d: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
}

pub fn convert_date_to_year(d: &str) -> Option<i32> {
    convert_string_to_date(d).map(|d| d.format("%Y").to_string().parse::<i32>().unwrap())
}

pub async fn get_data_parallely_from_sources<'a, T, F, R>(
    iteree: &'a [T],
    client: &'a Client,
    get_url: F,
) -> Vec<R>
where
    F: Fn(&T) -> String,
    T: Send + Sync + de::DeserializeOwned + 'static,
    R: Send + Sync + de::DeserializeOwned + 'static,
{
    let mut set = JoinSet::new();
    for elm in iteree.iter() {
        let client = client.clone();
        let url = get_url(elm);
        set.spawn(async move {
            let mut rsp = client.get(url).await.unwrap();
            let single_element: R = rsp.body_json().await.unwrap();
            single_element
        });
    }
    let mut data = vec![];
    while let Some(Ok(result)) = set.join_next().await {
        data.push(result);
    }
    data
}

pub mod tmdb {
    use crate::graphql::PROJECT_NAME;

    use super::*;

    pub async fn get_client_config(url: &str, access_token: &str) -> (Client, String) {
        let client: Client = Config::new()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
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
}

pub mod igdb {
    use crate::graphql::PROJECT_NAME;

    use super::*;

    pub async fn get_client_config(
        twitch_base_url: &str,
        twitch_client_id: &str,
        twitch_client_secret: &str,
        igdb_base_url: &str,
    ) -> Client {
        #[derive(Deserialize, Serialize)]
        struct Query {
            client_id: String,
            client_secret: String,
            grant_type: String,
        }
        let mut access_res = surf::post(twitch_base_url)
            .query(&Query {
                client_id: twitch_client_id.to_owned(),
                client_secret: twitch_client_secret.to_owned(),
                grant_type: "client_credentials".to_owned(),
            })
            .unwrap()
            .await
            .unwrap();
        #[derive(Deserialize, Serialize, Default)]
        struct AccessResponse {
            access_token: String,
            token_type: String,
        }
        let access = access_res
            .body_json::<AccessResponse>()
            .await
            .unwrap_or_default();
        let client: Client = Config::new()
            .add_header("Client-ID", twitch_client_id)
            .unwrap()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .add_header(
                AUTHORIZATION,
                format!("{} {}", access.token_type, access.access_token),
            )
            .unwrap()
            .set_base_url(Url::parse(igdb_base_url).unwrap())
            .try_into()
            .unwrap();
        client
    }
}

pub mod openlibrary {
    pub fn get_key(key: &str) -> String {
        key.split('/')
            .collect::<Vec<_>>()
            .last()
            .cloned()
            .unwrap()
            .to_owned()
    }
}
