use std::sync::Arc;

use anyhow::Result;
use common_utils::{APPLICATION_JSON_HEADER, USER_AGENT_STR, ryot_log, sleep_for_n_seconds};
use database_models::{metadata, prelude::Metadata};
use dependent_utils::deploy_update_metadata_job;
use enum_models::{MediaLot, MediaSource};
use reqwest::{
    Client, ClientBuilder,
    header::{ACCEPT, AUTHORIZATION, HeaderMap, HeaderValue, USER_AGENT},
};
use sea_orm::{
    prelude::DateTimeUtc,
    {ColumnTrait, EntityTrait, QueryFilter},
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

pub mod jellyfin {
    use super::*;

    #[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq)]
    pub enum MediaType {
        Movie,
        Series,
        Episode,
        #[serde(untagged)]
        Unknown(String),
    }

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct ItemProviderIdsPayload {
        pub tmdb: Option<String>,
    }

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct ItemUserData {
        pub last_played_date: Option<DateTimeUtc>,
        pub is_favorite: Option<bool>,
    }

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct ItemResponse {
        pub id: String,
        pub name: String,
        #[serde(rename = "Type")]
        pub typ: Option<MediaType>,
        pub index_number: Option<i32>,
        pub series_id: Option<String>,
        pub series_name: Option<String>,
        pub user_data: Option<ItemUserData>,
        pub parent_index_number: Option<i32>,
        pub provider_ids: Option<ItemProviderIdsPayload>,
    }

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct ItemsResponse {
        pub items: Vec<ItemResponse>,
    }

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct AuthenticateResponse {
        pub user: ItemResponse,
        pub access_token: String,
    }

    pub async fn get_authenticated_client(
        base_url: &String,
        username: &String,
        password: &Option<String>,
    ) -> Result<(Client, String)> {
        let mut emby_header_value =
            r#"MediaBrowser , Client="other", Device="script", DeviceId="script", Version="0.0.0""#
                .to_string();
        let uri = format!("{}/Users/AuthenticateByName", base_url);
        let client = Client::new();
        let authenticate_request = client
            .post(uri)
            .header(AUTHORIZATION, &emby_header_value)
            .json(&serde_json::json!({
                "Username": username,
                "Pw": password.clone().unwrap_or_default()
            }));
        ryot_log!(debug, "Authentication request: {:?}", authenticate_request);
        let authenticate = authenticate_request
            .send()
            .await
            .unwrap()
            .json::<AuthenticateResponse>()
            .await
            .unwrap();
        ryot_log!(
            debug,
            "Authenticated with token: {}",
            authenticate.access_token
        );

        emby_header_value.push_str(&format!(r#", Token="{}""#, authenticate.access_token));

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_STR));
        headers.insert(ACCEPT, APPLICATION_JSON_HEADER.clone());
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&emby_header_value).unwrap(),
        );
        let client: Client = ClientBuilder::new()
            .default_headers(headers)
            .build()
            .unwrap();
        let user_id = authenticate.user.id;
        ryot_log!(debug, "Authenticated as user id: {}", user_id);

        Ok((client, user_id))
    }
}

pub mod audiobookshelf {
    use super::*;

    pub async fn get_updated_podcast_metadata(
        identifier: &String,
        ss: &Arc<SupportingService>,
    ) -> Result<metadata::Model> {
        async fn get_metadata(
            identifier: &String,
            ss: &Arc<SupportingService>,
        ) -> Result<metadata::Model> {
            let m = Metadata::find()
                .filter(metadata::Column::Identifier.eq(identifier))
                .filter(metadata::Column::Lot.eq(MediaLot::Podcast))
                .filter(metadata::Column::Source.eq(MediaSource::Itunes))
                .one(&ss.db)
                .await?
                .unwrap();
            Ok(m)
        }

        let already = get_metadata(identifier, ss).await?;
        if already.podcast_specifics.is_none() {
            deploy_update_metadata_job(&already.id, ss).await.unwrap();
            sleep_for_n_seconds(3).await;
        }
        get_metadata(identifier, ss).await
    }
}
