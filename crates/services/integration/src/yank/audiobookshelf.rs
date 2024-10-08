use std::future::Future;

use anyhow::{anyhow, Result};
use application_utils::get_base_http_client;
use async_graphql::Result as GqlResult;
use common_models::DefaultCollection;
use common_utils::ryot_log;
use database_models::metadata;
use dependent_models::ImportResult;
use enums::{MediaLot, MediaSource};
use media_models::{CommitMediaInput, ImportOrExportMediaItem, ImportOrExportMediaItemSeen};
use providers::google_books::GoogleBooksService;
use reqwest::header::{HeaderValue, AUTHORIZATION};
use rust_decimal_macros::dec;
use specific_models::audiobookshelf::{self, LibrariesListResponse, ListResponse};

use crate::traita::YankIntegrationWithCommit;

pub(crate) struct AudiobookshelfIntegration {
    base_url: String,
    access_token: String,
    sync_to_owned_collection: Option<bool>,
    isbn_service: GoogleBooksService,
}

impl AudiobookshelfIntegration {
    pub fn new(
        base_url: String,
        access_token: String,
        sync_to_owned_collection: Option<bool>,
        isbn_service: GoogleBooksService,
    ) -> Self {
        Self {
            base_url,
            access_token,
            sync_to_owned_collection,
            isbn_service,
        }
    }
}

impl YankIntegrationWithCommit for AudiobookshelfIntegration {
    async fn yank_progress<F>(
        &self,
        commit_metadata: impl Fn(CommitMediaInput) -> F,
    ) -> Result<ImportResult>
    where
        F: Future<Output = GqlResult<metadata::Model>>,
    {
        let url = format!("{}/api", self.base_url);
        let client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", self.access_token)).unwrap(),
        )]));

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
                        Some(isbn) => match self.isbn_service.id_from_isbn(isbn).await {
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
                            let podcast = commit_metadata(CommitMediaInput {
                                identifier: itunes_id.clone(),
                                lot,
                                source,
                                ..Default::default()
                            })
                            .await
                            .unwrap();
                            match podcast
                                .podcast_specifics
                                .and_then(|p| p.episode_by_name(&pe.title))
                            {
                                Some(episode) => (
                                    format!("{}/{}", item.id, pe.id),
                                    itunes_id,
                                    lot,
                                    source,
                                    Some(episode),
                                ),
                                _ => {
                                    ryot_log!(
                                        debug,
                                        "No podcast found for iTunes ID {:#?}",
                                        itunes_id
                                    );
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
                    result.media.push(ImportOrExportMediaItem {
                        lot,
                        source,
                        identifier,
                        seen_history: vec![ImportOrExportMediaItemSeen {
                            podcast_episode_number,
                            progress: Some(progress * dec!(100)),
                            provider_watched_on: Some("Audiobookshelf".to_string()),
                            ..Default::default()
                        }],
                        ..Default::default()
                    });
                }
                Err(e) => {
                    ryot_log!(debug, "Error getting progress for item {:?}: {:?}", item, e);
                    continue;
                }
            };
        }
        if let Some(true) = self.sync_to_owned_collection {
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
                    .get(&format!("libraries/{}/items", library.id))
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
                                Some(isbn) => match self.isbn_service.id_from_isbn(isbn).await {
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
                    result.media.push(ImportOrExportMediaItem {
                        identifier,
                        lot,
                        source,
                        collections: vec![DefaultCollection::Owned.to_string()],
                        ..Default::default()
                    });
                }
            }
        }
        Ok(result)
    }
}
