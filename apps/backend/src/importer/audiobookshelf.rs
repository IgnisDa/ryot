use anyhow::anyhow;
use async_graphql::Result;
use data_encoding::BASE64;
use database::{ImportSource, MediaLot, MediaSource};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::http::headers::AUTHORIZATION;

use crate::{
    importer::{ImportFailStep, ImportFailedItem, ImportResult},
    miscellaneous::{audiobookshelf_models, itunes_podcast_episode_by_name},
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
    },
    providers::google_books::GoogleBooksService,
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

pub async fn import(
    input: DeployUrlAndKeyImportInput,
    isbn_service: &GoogleBooksService,
    db: &DatabaseConnection,
) -> Result<ImportResult> {
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
        let mut query = json!({ "expanded": "1" });
        if let Some(audiobookshelf_models::MediaType::Book) = library.media_type {
            query["filter"] = json!(format!("progress.{}", BASE64.encode(b"finished")));
        }
        let finished_items: ListResponse = client
            .get(&format!("libraries/{}/items", library.id))
            .query(&query)
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .unwrap();
        for item in finished_items.results {
            let metadata = item.media.clone().unwrap().metadata;
            let title = metadata.title.clone();
            let (identifier, lot, source, episodes) =
                if Some("epub".to_string()) == item.media.as_ref().unwrap().ebook_format {
                    match &metadata.isbn {
                        Some(isbn) => match isbn_service.id_from_isbn(isbn).await {
                            Some(id) => (id, MediaLot::Book, MediaSource::GoogleBooks, None),
                            _ => {
                                failed_items.push(ImportFailedItem {
                                    error: Some("No Google Books ID found".to_string()),
                                    identifier: title,
                                    lot: None,
                                    step: ImportFailStep::InputTransformation,
                                });
                                continue;
                            }
                        },
                        _ => {
                            failed_items.push(ImportFailedItem {
                                error: Some("No ISBN found".to_string()),
                                identifier: title,
                                lot: None,
                                step: ImportFailStep::InputTransformation,
                            });
                            continue;
                        }
                    }
                } else if let Some(asin) = metadata.asin.clone() {
                    (asin, MediaLot::AudioBook, MediaSource::Audible, None)
                } else if let Some(itunes_id) = metadata.itunes_id.clone() {
                    // TODO: If it is a podcast, we use will have to request for each episode in the following manner:
                    // curl "https://abs.wobblehouse.com/api/items/0d80aad6-a474-4d48-bb5b-f3628d47e4a0?include=progress&expanded=1&episode=f8e60387-c746-4850-8f9e-c2672c166438"
                    // then use `userMediaProgress.isFinished` to determine if the podcast episode is complete
                    if let Ok(pe) =
                        itunes_podcast_episode_by_name(&metadata.title, &itunes_id, db).await
                    {
                        (
                            itunes_id,
                            MediaLot::Podcast,
                            MediaSource::Itunes,
                            Some(vec![1, 2, 3]),
                        )
                    } else {
                        failed_items.push(ImportFailedItem {
                            error: Some("No recent episode found".to_string()),
                            identifier: title,
                            lot: Some(MediaLot::Podcast),
                            step: ImportFailStep::ItemDetailsFromSource,
                        });
                        continue;
                    }
                } else {
                    tracing::debug!("No ASIN, ISBN or iTunes ID found for item {:#?}", item);
                    continue;
                };
            let mut seen_history = vec![];
            if let Some(podcasts) = episodes {
                for episode in podcasts {
                    seen_history.push(ImportOrExportMediaItemSeen {
                        provider_watched_on: Some(ImportSource::Audiobookshelf.to_string()),
                        podcast_episode_number: Some(episode),
                        ..Default::default()
                    });
                }
            } else {
                seen_history.push(ImportOrExportMediaItemSeen {
                    provider_watched_on: Some(ImportSource::Audiobookshelf.to_string()),
                    ..Default::default()
                });
            };
            media.push(ImportOrExportMediaItem {
                lot,
                source,
                source_id: metadata.title,
                identifier: "".to_string(),
                internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(identifier)),
                seen_history,
                collections: vec![],
                reviews: vec![],
            })
        }
    }
    dbg!(&media);
    Ok(ImportResult {
        media,
        failed_items,
        ..Default::default()
    })
}
