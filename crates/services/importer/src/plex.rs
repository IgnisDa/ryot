use application_utils::get_base_http_client;
use async_graphql::Result;
use common_models::StringIdObject;
use common_utils::ryot_log;
use dependent_models::ImportResult;
use media_models::DeployUrlAndKeyImportInput;
use reqwest::header::{HeaderName, HeaderValue, ACCEPT};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct PlexMetadataItem {
    title: String,
    #[serde(rename = "type")]
    item_type: String,
    key: String,
    #[serde(rename = "Guid")]
    guid: Option<Vec<StringIdObject>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PlexLibrary {
    pub directory: Vec<PlexMetadataItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PlexMetadata {
    pub metadata: Vec<PlexMetadataItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PlexMediaResponse<T> {
    pub media_container: T,
}

pub async fn import(input: DeployUrlAndKeyImportInput) -> Result<ImportResult> {
    let client = get_base_http_client(Some(vec![
        (
            HeaderName::from_static("x-plex-token"),
            HeaderValue::from_str(&input.api_key).unwrap(),
        ),
        (ACCEPT, HeaderValue::from_static("application/json")),
    ]));
    let libraries = client
        .get(format!("{}/library/sections", input.api_url))
        .send()
        .await?
        .json::<PlexMediaResponse<PlexLibrary>>()
        .await?;
    for dir in libraries.media_container.directory {
        ryot_log!(debug, "Processing directory {:?}", dir.title);
        if !["movie", "show"].contains(&dir.item_type.as_str()) {
            ryot_log!(debug, "Skipping directory {:?}", dir.title);
            continue;
        }
        let items = client
            .get(format!(
                "{}/library/sections/{}/all",
                input.api_url, dir.key
            ))
            .query(&serde_json::json!({ "includeGuids": "1" }))
            .send()
            .await?
            .json::<PlexMediaResponse<PlexMetadata>>()
            .await?;
        dbg!(items.media_container.metadata);
    }
    todo!()
}
