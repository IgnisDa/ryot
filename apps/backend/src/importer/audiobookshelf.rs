use anyhow::anyhow;
use async_graphql::Result;
use data_encoding::BASE64;
use database::{ImportSource, MediaLot, MediaSource};
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::http::headers::AUTHORIZATION;

use crate::{
    importer::{ImportFailStep, ImportFailedItem, ImportResult},
    miscellaneous::audiobookshelf_models,
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
    },
    utils::get_base_http_client,
};

use super::DeployUrlAndKeyImportInput;

#[derive(Debug, Serialize, Deserialize)]
pub struct LibrariesListResponse {
    pub libraries: Vec<audiobookshelf_models::Item>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListResponse {
    pub results: Vec<audiobookshelf_models::Item>,
}

pub async fn import(input: DeployUrlAndKeyImportInput) -> Result<ImportResult> {
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
        tracing::debug!("Importing library {:?}", library.name.unwrap());
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
            dbg!(&item);
            let metadata = item.media.unwrap().metadata;
            match item.media_type.unwrap() {
                audiobookshelf_models::MediaType::Book => {
                    let lot = MediaLot::AudioBook;
                    if let Some(asin) = metadata.asin {
                        media.push(ImportOrExportMediaItem {
                            internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
                                asin,
                            )),
                            lot,
                            source: MediaSource::Audible,
                            source_id: metadata.title,
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
                            identifier: metadata.title,
                            lot: Some(lot),
                            step: ImportFailStep::InputTransformation,
                        });
                    }
                }
                s => {
                    failed_items.push(ImportFailedItem {
                        error: Some(format!("Import of {s:#?} media type is not supported yet")),
                        identifier: metadata.title,
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
