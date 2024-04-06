use anyhow::anyhow;
use async_graphql::Result;
use data_encoding::BASE64;
use database::{ImportSource, MediaLot, MediaSource};
use serde::{Deserialize, Serialize};
use serde_json::json;
use strum::Display;
use surf::http::headers::AUTHORIZATION;

use crate::{
    importer::{ImportFailStep, ImportFailedItem, ImportResult},
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
    },
    utils::get_base_http_client,
};

use super::DeployAudiobookshelfImportInput;

#[derive(Debug, Serialize, Deserialize, Clone, Display)]
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
            let metadata = item.media.unwrap().metadata.unwrap();
            match item.media_type.unwrap() {
                MediaType::Book => {
                    let lot = MediaLot::AudioBook;
                    if let Some(asin) = metadata.asin {
                        media.push(ImportOrExportMediaItem {
                            internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails {
                                identifier: asin,
                                title: metadata.title.clone().unwrap_or_default(),
                            }),
                            lot,
                            source: MediaSource::Audible,
                            source_id: metadata.title.unwrap_or_default(),
                            identifier: "".to_string(),
                            seen_history: vec![ImportOrExportMediaItemSeen {
                                provider_watched_on: Some(ImportSource::Audiobookshelf.to_string()),
                                ..Default::default()
                            }],
                            collections: vec![],
                            reviews: vec![],
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
                s => {
                    failed_items.push(ImportFailedItem {
                        error: Some(format!("Import of {s:#?} media type is not supported yet")),
                        identifier: metadata.title.unwrap_or_default(),
                        lot: None,
                        step: ImportFailStep::ItemDetailsFromSource,
                    });
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
