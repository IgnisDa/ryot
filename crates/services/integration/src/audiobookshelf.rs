use std::future::Future;

use anyhow::anyhow;
use application_utils::get_base_http_client;
use async_graphql::Result as GqlResult;
use database_models::metadata;
use enums::{MediaLot, MediaSource};
use media_models::{CommitMediaInput, IntegrationMediaCollection, IntegrationMediaSeen};
use providers::google_books::GoogleBooksService;
use reqwest::header::{HeaderValue, AUTHORIZATION};
use rust_decimal_macros::dec;
use specific_models::audiobookshelf;

use super::integration_trait::YankIntegrationWithCommit;

pub(crate) struct AudiobookshelfIntegration {
    base_url: String,
    access_token: String,
    isbn_service: GoogleBooksService,
}

impl AudiobookshelfIntegration {
    pub fn new(base_url: String, access_token: String, isbn_service: GoogleBooksService) -> Self {
        Self {
            base_url,
            access_token,
            isbn_service,
        }
    }
}

impl YankIntegrationWithCommit for AudiobookshelfIntegration {
    async fn yank_progress<F>(
        &self,
        commit_metadata: impl Fn(CommitMediaInput) -> F,
    ) -> anyhow::Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>
    where
        F: Future<Output = GqlResult<metadata::Model>>,
    {
        let client = get_base_http_client(
            &format!("{}/api/", self.base_url),
            Some(vec![(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.access_token)).unwrap(),
            )]),
        );

        let resp = client
            .get("me/items-in-progress")
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<audiobookshelf::Response>()
            .await
            .map_err(|e| anyhow!(e))?;

        tracing::debug!("Got response for items in progress {:?}", resp);

        let mut media_items = vec![];

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
                                tracing::debug!("No Google Books ID found for ISBN {:#?}", isbn);
                                continue;
                            }
                        },
                        _ => {
                            tracing::debug!("No ISBN found for item {:#?}", item);
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
                                    tracing::debug!(
                                        "No podcast found for iTunes ID {:#?}",
                                        itunes_id
                                    );
                                    continue;
                                }
                            }
                        }
                        _ => {
                            tracing::debug!("No recent episode found for item {:#?}", item);
                            continue;
                        }
                    }
                } else {
                    tracing::debug!("No ASIN, ISBN or iTunes ID found for item {:#?}", item);
                    continue;
                };

            match client
                .get(format!("me/progress/{}", progress_id))
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<audiobookshelf::ItemProgress>()
                .await
                .map_err(|e| anyhow!(e))
            {
                Ok(resp) => {
                    tracing::debug!("Got response for individual item progress {:?}", resp);
                    let progress = if let Some(ebook_progress) = resp.ebook_progress {
                        ebook_progress
                    } else {
                        resp.progress
                    };
                    media_items.push(IntegrationMediaSeen {
                        lot,
                        source,
                        identifier,
                        podcast_episode_number,
                        progress: progress * dec!(100),
                        provider_watched_on: Some("Audiobookshelf".to_string()),
                        ..Default::default()
                    });
                }
                Err(e) => {
                    tracing::debug!("Error getting progress for item {:?}: {:?}", item, e);
                    continue;
                }
            };
        }

        Ok((media_items, vec![]))
    }
}
