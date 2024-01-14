use anyhow::anyhow;
use async_graphql::Result;
use data_encoding::BASE64;
use database::{MetadataLot, MetadataSource};
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::http::headers::AUTHORIZATION;

use crate::{
    importer::{ImportFailStep, ImportFailedItem, ImportResult},
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
    },
    utils::get_base_http_client,
};

use super::DeployAudiobookshelfImportInput;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum MediaType {
    Book,
    Podcast,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListItemMetadata {
    asin: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListItem {
    id: String,
    media_type: Option<MediaType>,
    name: Option<String>,
    metadata: Option<LibraryListItemMetadata>,
    media: Option<Box<LibraryListItem>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LibrariesListResponse {
    pub libraries: Vec<LibraryListItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListResponse {
    pub results: Vec<LibraryListItem>,
}

pub async fn import(input: DeployAudiobookshelfImportInput) -> Result<ImportResult> {
    let mut media = vec![];
    let mut failed_items = vec![];
    let client = get_base_http_client(
        &format!("{}/api/", input.api_url),
        vec![(AUTHORIZATION, format!("Bearer {}", input.api_key))],
    );
    let libraries_resp: LibrariesListResponse = client
        .get("libraries")
        .await
        .map_err(|e| anyhow!(e))?
        .body_json()
        .await
        .unwrap();
    for library in libraries_resp.libraries {
        tracing::debug!("Importing library {:?}", library.name);
        let finished_items: ListResponse = client
            .get(&format!("libraries/{}/items", library.id))
            .query(&json!({ "filter": format!("progress.{}", BASE64.encode(b"finished")) }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .unwrap();
        for item in finished_items.results {
            if let Some(lib_media) = item.media {
                if let Some(metadata) = lib_media.metadata {
                    match item.media_type.unwrap() {
                        MediaType::Book => {
                            let lot = MetadataLot::AudioBook;
                            if let Some(asin) = metadata.asin {
                                media.push(ImportOrExportMediaItem {
                                    internal_identifier: Some(
                                        ImportOrExportItemIdentifier::NeedsDetails(asin),
                                    ),
                                    lot,
                                    source: MetadataSource::Audible,
                                    source_id: metadata.title.unwrap_or_default(),
                                    identifier: item.id,
                                    collections: vec![],
                                    reviews: vec![],
                                    seen_history: vec![ImportOrExportMediaItemSeen {
                                        ..Default::default()
                                    }],
                                })
                            } else {
                                failed_items.push(ImportFailedItem {
                                    error: Some("No ASIN found".to_string()),
                                    identifier: metadata.title.unwrap_or_default(),
                                    lot: Some(lot),
                                    step: ImportFailStep::InputTransformation,
                                });
                            }
                        }
                        MediaType::Podcast => {
                            tracing::error!("Podcasts are not supported yet");
                        }
                    }
                }
            }
        }
    }
    Ok(ImportResult {
        collections: vec![],
        media,
        failed_items,
        workouts: vec![],
    })
}
