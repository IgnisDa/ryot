use async_graphql::Result;
use database::{MediaLot, MediaSource};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use surf::{
    http::headers::{ACCEPT, USER_AGENT},
    Client, Config, Url,
};

use crate::{
    importer::{
        DeployUrlAndKeyAndUsernameImportInput, ImportFailStep, ImportFailedItem, ImportResult,
    },
    models::media::{ImportOrExportItemIdentifier, ImportOrExportMediaItem},
    utils::USER_AGENT_STR,
};

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum CollectionType {
    Movies,
    Tvshows,
    #[serde(untagged)]
    Unknown(String),
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq)]
enum MediaType {
    Movie,
    Series,
    #[serde(untagged)]
    Unknown(String),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemProviderIdsPayload {
    tmdb: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemResponse {
    id: String,
    name: String,
    #[serde(rename = "Type")]
    typ: Option<MediaType>,
    collection_type: Option<CollectionType>,
    provider_ids: Option<ItemProviderIdsPayload>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemsResponse {
    items: Vec<ItemResponse>,
}

pub async fn import(input: DeployUrlAndKeyAndUsernameImportInput) -> Result<ImportResult> {
    let mut media = vec![];
    let mut failed_items = vec![];
    let client: Client = Config::new()
        .add_header(USER_AGENT, USER_AGENT_STR)
        .unwrap()
        .add_header(ACCEPT, "application/json")
        .unwrap()
        .add_header("X-Emby-Token", input.api_key)
        .unwrap()
        .set_base_url(Url::parse(&input.api_url).unwrap().join("/").unwrap())
        .try_into()
        .unwrap();

    let users_data: Vec<ItemResponse> = client
        .get("Users")
        .await
        .unwrap()
        .body_json()
        .await
        .unwrap();
    let user_id = users_data
        .into_iter()
        .find(|x| x.name == input.username)
        .unwrap()
        .id;

    let views_data: ItemsResponse = client
        .get(&format!("Users/{}/Views", user_id))
        .await
        .unwrap()
        .body_json()
        .await
        .unwrap();
    for library in views_data.items {
        let collection_type = library.collection_type.unwrap();
        if matches!(collection_type, CollectionType::Unknown(_)) {
            failed_items.push(ImportFailedItem {
                step: ImportFailStep::ItemDetailsFromSource,
                identifier: library.name,
                error: Some(format!("Unknown collection type: {:?}", collection_type)),
                lot: None,
            });
            continue;
        }
        let mut query = json!({
            "parentId": library.id, "recursive": true,
            "includeItemTypes": "Movie,Series", "fields": "ProviderIds"
        });
        if collection_type == CollectionType::Movies {
            query["filters"] = Value::String("IsPlayed".to_string());
        }
        let library_data: ItemsResponse = client
            .get(&format!("Users/{}/Items", user_id))
            .query(&query)
            .unwrap()
            .await
            .unwrap()
            .body_json()
            .await
            .unwrap();
        for item in library_data.items {
            let typ = item.typ.unwrap();
            match typ.clone() {
                MediaType::Movie => {
                    let tmdb_id = item.provider_ids.unwrap().tmdb.unwrap();
                    media.push(ImportOrExportMediaItem {
                        source_id: item.name,
                        lot: MediaLot::Movie,
                        source: MediaSource::Tmdb,
                        internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
                            tmdb_id,
                        )),
                        identifier: "".to_string(),
                        seen_history: vec![],
                        reviews: vec![],
                        collections: vec![],
                    });
                }
                _ => {
                    failed_items.push(ImportFailedItem {
                        step: ImportFailStep::ItemDetailsFromSource,
                        identifier: item.name,
                        error: Some(format!("Unknown media type: {:?}", typ)),
                        lot: None,
                    });
                    continue;
                }
            }
        }
    }

    Ok(ImportResult {
        media,
        failed_items,
        ..Default::default()
    })
}
