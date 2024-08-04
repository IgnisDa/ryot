use anyhow::{anyhow, Result, Context};
use futures::StreamExt;
use rust_decimal::Decimal;
use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait};
use sea_query::Expr;
use tokio::sync::{mpsc, mpsc::error::TryRecvError};
use database::{MediaLot, MediaSource, };
use eventsource_stream::Eventsource;
use rust_decimal::prelude::{FromPrimitive, Zero};
use super::{IntegrationMediaCollection, IntegrationMediaSeen, IntegrationService};
use crate::{
    miscellaneous::SSEObjects,
    entities::{metadata, prelude::Metadata},
    utils::{get_base_http_client, },
    models::komga_events
};

mod komga_book {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Link {
        pub label: String,
        pub url: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Media {
        pub pages_count: i32
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Metadata {
        pub links: Vec<Link>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ReadProgress {
        pub page: i32,
        pub completed: bool,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Item {
        pub id: String,
        pub name: String,
        pub series_id: String,
        pub media: Media,
        pub number: i32,
        pub read_progress: ReadProgress,
    }
}

mod komga_series {
    use openidconnect::url::Url;
    use serde::{Deserialize, Serialize};
    use super::*;

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Link {
        pub label: String,
        pub url: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Metadata {
        pub links: Vec<Link>,
    }

    impl Metadata {
        fn extract_id(&self, url: String) -> Option<String> {
            if let Ok(parsed_url) = Url::parse(&url) {
                parsed_url.path_segments()
                    .and_then(|segments| segments.collect::<Vec<_>>().get(1).cloned())
                    .map(String::from)
            } else {
                None
            }
        }

        pub fn find_providers(&self) -> Vec<(Option<MediaSource>,Option<String>)> {
            let mut provider_links = vec![];
            for link in self.links.iter() {
                let source;

                // NOTE: mangaupdates doesnt work here because the ID isnt in the url
                match link.label.to_lowercase().as_str() {
                    "anilist" => source = Some(MediaSource::Anilist),
                    "myanimelist" => source = Some(MediaSource::Mal),
                    _ => continue
                }

                if source.is_some() {
                    let id = self.extract_id(link.url.clone());
                    provider_links.push((source, id));
                }
            }

            provider_links.sort_by_key(|a| a.1.clone());
            provider_links
        }
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Item {
        pub id: String,
        pub name: String,
        // pub number: Decimal,
        pub books_count: Decimal,
        pub books_read_count: Option<i32>,
        pub books_unread_count: Decimal,
        pub metadata: Metadata,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Response {
        pub content: Vec<Item>,
    }
}

impl IntegrationService {

    async fn sse_listener(sender: mpsc::Sender<komga_events::Data>,
                          base_url: String,
                          cookie: String,) -> anyhow::Result<(), Box<dyn std::error::Error>> {
        let client = get_base_http_client(&format!("{}/sse/v1/", base_url), None);

        loop {
            let response = client
                .get("events")
                .header("Cookie", cookie.clone())
                .send()
                .await
                .context("Failed to send request")?;

            let mut stream = response.bytes_stream().eventsource();

            while let Some(event) = stream.next().await {
                let event = event.context("Failed to get next event")?;
                tracing::trace!(?event, "Received SSE event");

                //TODO: Handle the deleted
                if event.event == "ReadProgressChanged" {
                    match serde_json::from_str::<komga_events::Data>(&event.data) {
                        Ok(read_progress) => {
                            if sender.send(read_progress).await.is_err() {
                                tracing::debug!("Receiver dropped, exiting SSE listener");
                                break;
                            }
                        }
                        Err(e) => {
                            tracing::warn!(error = ?e, data = ?event.data,
                                "Failed to parse ReadProgressChanged event data");
                        }
                    }
                } else {
                    tracing::trace!(event_type = ?event.event, "Received unhandled event type");
                }
            }

            tracing::trace!("SSE listener finished");
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    }

    async fn fetch_book(client: &reqwest::Client,
                        book_id: &str,
                        cookie: &str) -> Result<komga_book::Item> {
        client
            .get(format!("books/{}", book_id))
            .header("Cookie", cookie)
            .send()
            .await?
            .error_for_status()?
            .json::<komga_book::Item>()
            .await
            .map_err(|e| anyhow!("Failed to parse book JSON: {}", e))
    }

    async fn fetch_series(client: &reqwest::Client,
                          series_id: &str,
                          cookie: &str) -> Result<komga_series::Item> {
        client
            .get(format!("series/{}", series_id))
            .header("Cookie", cookie)
            .send()
            .await?
            .error_for_status()?
            .json::<komga_series::Item>()
            .await
            .map_err(|e| anyhow!("Failed to parse series JSON: {}", e))
    }


    async fn find_provider_and_id(
        series: &komga_series::Item,
        provider: MediaSource,
        db: &DatabaseConnection
    ) -> Result<(Option<MediaSource>, Option<String>)> {
        let providers = series.metadata.find_providers();
        if !providers.is_empty() {
            Ok(providers
                .iter()
                .find(|x| x.0.unwrap() == provider)
                .cloned()
                .or_else(|| providers.first().cloned())
                .unwrap_or((None, None)))
        } else {
            let db_manga = Metadata::find()
                .filter(metadata::Column::Lot.eq(MediaLot::Manga))
                .filter(Expr::col(metadata::Column::Title).eq(&series.name))
                .one(db)
                .await?;

            Ok(db_manga
                .map(|manga| (Some(manga.source), Some(manga.identifier)))
                .unwrap_or((None, None)))
        }
    }

    fn calculate_percentage(curr_page: i32, total_page: i32) -> Decimal {
        if total_page == 0 {
            return Decimal::zero(); // Handle division by zero case
        }

        // Perform the calculation using floating-point arithmetic
        let percentage = (curr_page as f64 / total_page as f64) * 100.0;

        // Convert the result to Decimal
        Decimal::from_f64(percentage).unwrap_or(Decimal::zero())
    }
    async fn process_events (
        &self,
        base_url: &str,
        cookie: &str,
        provider: MediaSource,
        data: komga_events::Data
    ) -> Option<IntegrationMediaSeen> {
        let client = get_base_http_client(&format!("{}/api/v1/", base_url), None);

        // Fetch book and series data
        let book =
            IntegrationService::fetch_book(&client, &data.book_id, cookie).await.ok()?;
        let series =
            IntegrationService::fetch_series(&client, &book.series_id, cookie).await.ok()?;

        // Find provider and ID
        let (source, id) =
            IntegrationService::find_provider_and_id(&series, provider, &self.db).await.ok()?;

        // If no ID is found, return None
        let Some(id) = id else {
            tracing::debug!("No MAL URL or database entry found for manga: {}", series.name);
            return None;
        };

        Some(IntegrationMediaSeen {
            identifier: id,
            lot: MediaLot::Manga,
            source: source.unwrap(),
            manga_chapter_number: Some(book.number),
            progress: IntegrationService::calculate_percentage(book.read_progress.page,
                                                               book.media.pages_count),
            provider_watched_on: Some("Komga".to_string()),
            ..Default::default()
        })
    }

    pub async fn komga_progress(
        &self,
        base_url: &str,
        cookie: &str,
        provider: MediaSource,
        sse_lists: &SSEObjects
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        let mutex_receiver = sse_lists.get_komga_receiver();
        let mut receiver = {
            let mut guard = mutex_receiver.lock().unwrap();
            guard.take()
        };

        if receiver.is_none() {
            let (tx, rx) = mpsc::channel::<komga_events::Data>(1000);
            receiver = Some(rx);

            let base_url = base_url.to_string();
            let cookie = cookie.to_string();
            let mutex_task = sse_lists.get_komga_task();

            mutex_task.get_or_init(|| {
                tokio::spawn(async move {
                    if let Err(e) =
                        IntegrationService::sse_listener(tx, base_url, cookie).await {
                        tracing::error!("SSE listener error: {}", e);
                    }
                });
            });
        }

        let mut media_items = vec![];

        if let Some(mut recv) = receiver {
            loop {
                match recv.try_recv() {
                    Ok(event) => {
                        tracing::debug!("Received event {:?}", event);
                        match self.process_events(base_url, cookie, provider, event).await {
                            Some(processed_event) =>
                                media_items.push(processed_event),
                            None => tracing::warn!("Failed to process event"),
                        }
                    },
                    Err(TryRecvError::Empty) => break,
                    Err(e) => return Err(anyhow::anyhow!("Receiver error: {}", e)),
                }
            }

            // Put the receiver back
            mutex_receiver.lock().unwrap().replace(recv);
        }

        Ok((media_items, vec![]))
    }
}