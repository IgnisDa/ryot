use std::future::Future;

use anyhow::{anyhow, Result};
use application_utils::{get_base_http_client, get_podcast_episode_number_by_name};
use async_graphql::Result as GqlResult;
use common_models::DefaultCollection;
use common_utils::ryot_log;
use database_models::metadata;
use dependent_models::{ImportCompletedItem, ImportResult};
use enums::{MediaLot, MediaSource};
use media_models::{
    ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen, UniqueMediaIdentifier,
};
use providers::google_books::GoogleBooksService;
use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Client,
};
use rust_decimal_macros::dec;
use specific_models::audiobookshelf::{self, LibrariesListResponse, ListResponse};

fn get_http_client(access_token: &String) -> Client {
    get_base_http_client(Some(vec![(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access_token)).unwrap(),
    )]))
}

pub async fn yank_progress<F>(
    base_url: String,
    access_token: String,
    // TODO: Find a way to use `get_identifier_from_book_isbn` function
    isbn_service: GoogleBooksService,
    commit_metadata: impl Fn(UniqueMediaIdentifier) -> F,
) -> Result<ImportResult>
where
    F: Future<Output = GqlResult<metadata::Model>>,
{
    let url = format!("{}/api", base_url);
    let client = get_http_client(&access_token);

    let resp = client
        .get(format!("{}/me/items-in-progress", url))
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<audiobookshelf::Response>()
        .await
        .map_err(|e| anyhow!(e))?;

    ryot_log!(debug, "Got response for items in progress {:?}", resp);

    let mut result = ImportResult::default();

    for item in resp.library_items.iter() {
        let metadata = item.media.clone().unwrap().metadata;
        let (progress_id, identifier, lot, source, podcast_episode_number) =
            if Some("epub".to_string()) == item.media.as_ref().unwrap().ebook_format {
                match &metadata.isbn {
                    Some(isbn) => match isbn_service.id_from_isbn(isbn).await {
                        Some(id) => (
                            item.id.clone(),
                            id,
                            MediaLot::Book,
                            MediaSource::GoogleBooks,
                            None,
                        ),
                        _ => {
                            ryot_log!(debug, "No Google Books ID found for ISBN {:#?}", isbn);
                            continue;
                        }
                    },
                    _ => {
                        ryot_log!(debug, "No ISBN found for item {:#?}", item);
                        continue;
                    }
                }
            } else if let Some(asin) = metadata.asin.clone() {
                (
                    item.id.clone(),
                    asin,
                    MediaLot::AudioBook,
                    MediaSource::Audible,
                    None,
                )
            } else if let Some(itunes_id) = metadata.itunes_id.clone() {
                match &item.recent_episode {
                    Some(pe) => {
                        let lot = MediaLot::Podcast;
                        let source = MediaSource::Itunes;
                        let podcast = commit_metadata(UniqueMediaIdentifier {
                            lot,
                            source,
                            identifier: itunes_id.clone(),
                        })
                        .await
                        .unwrap();
                        match podcast
                            .podcast_specifics
                            .and_then(|p| get_podcast_episode_number_by_name(&p, &pe.title))
                        {
                            Some(episode) => (
                                format!("{}/{}", item.id, pe.id),
                                itunes_id,
                                lot,
                                source,
                                Some(episode),
                            ),
                            _ => {
                                ryot_log!(debug, "No podcast found for iTunes ID {:#?}", itunes_id);
                                continue;
                            }
                        }
                    }
                    _ => {
                        ryot_log!(debug, "No recent episode found for item {:?}", item);
                        continue;
                    }
                }
            } else {
                ryot_log!(
                    debug,
                    "No ASIN, ISBN or iTunes ID found for item {:?}",
                    item
                );
                continue;
            };

        match client
            .get(format!("{}/me/progress/{}", url, progress_id))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<audiobookshelf::ItemProgress>()
            .await
            .map_err(|e| anyhow!(e))
        {
            Ok(resp) => {
                ryot_log!(
                    debug,
                    "Got response for individual item progress {:?}",
                    resp
                );
                let progress = if let Some(ebook_progress) = resp.ebook_progress {
                    ebook_progress
                } else {
                    resp.progress
                };
                result
                    .completed
                    .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                        lot,
                        source,
                        identifier,
                        seen_history: vec![ImportOrExportMetadataItemSeen {
                            podcast_episode_number,
                            progress: Some(progress * dec!(100)),
                            provider_watched_on: Some("Audiobookshelf".to_string()),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }));
            }
            Err(e) => {
                ryot_log!(debug, "Error getting progress for item {:?}: {:?}", item, e);
                continue;
            }
        };
    }
    Ok(result)
}

pub async fn sync_to_owned_collection(
    access_token: String,
    isbn_service: GoogleBooksService,
) -> Result<ImportResult> {
    let client = get_http_client(&access_token);

    let mut result = ImportResult::default();
    let libraries_resp = client
        .get("libraries")
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<LibrariesListResponse>()
        .await
        .unwrap();
    for library in libraries_resp.libraries {
        let items = client
            .get(format!("libraries/{}/items", library.id))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<ListResponse>()
            .await
            .unwrap();
        for item in items.results.into_iter() {
            let metadata = item.media.clone().unwrap().metadata;
            let (identifier, lot, source) =
                if Some("epub".to_string()) == item.media.as_ref().unwrap().ebook_format {
                    match &metadata.isbn {
                        Some(isbn) => match isbn_service.id_from_isbn(isbn).await {
                            Some(id) => (id, MediaLot::Book, MediaSource::GoogleBooks),
                            _ => continue,
                        },
                        _ => continue,
                    }
                } else if let Some(asin) = metadata.asin.clone() {
                    (asin, MediaLot::AudioBook, MediaSource::Audible)
                } else if let Some(itunes_id) = metadata.itunes_id.clone() {
                    (itunes_id, MediaLot::Podcast, MediaSource::Itunes)
                } else {
                    continue;
                };
            result
                .completed
                .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                    lot,
                    source,
                    identifier,
                    collections: vec![DefaultCollection::Owned.to_string()],
                    ..Default::default()
                }));
        }
    }
    Ok(result)
}
