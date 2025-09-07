use anyhow::Result;
use application_utils::get_base_http_client;
use common_utils::{APPLICATION_JSON_HEADER, ryot_log};
use reqwest::{
    Client,
    header::{ACCEPT, AUTHORIZATION, HeaderValue},
};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

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
        let uri = format!("{base_url}/Users/AuthenticateByName");
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

        let client = get_base_http_client(Some(vec![
            (ACCEPT, APPLICATION_JSON_HEADER),
            (
                AUTHORIZATION,
                HeaderValue::from_str(&emby_header_value).unwrap(),
            ),
        ]));
        let user_id = authenticate.user.id;
        ryot_log!(debug, "Authenticated as user id: {}", user_id);

        Ok((client, user_id))
    }
}
