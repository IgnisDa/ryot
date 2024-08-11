use std::{
    collections::{hash_map::Entry, HashMap},
    sync::{Mutex, OnceLock},
};

use anyhow::{anyhow, Context, Result};
use database::{MediaLot, MediaSource};
use eventsource_stream::Eventsource;
use futures::StreamExt;
use rust_decimal::{
    prelude::{FromPrimitive, Zero},
    Decimal,
};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::Expr;
use serde::de::DeserializeOwned;
use tokio::sync::{mpsc, mpsc::error::TryRecvError, mpsc::UnboundedReceiver};

use super::{IntegrationMediaCollection, IntegrationMediaSeen, IntegrationService};

use crate::{
    entities::{metadata, prelude::Metadata},
    utils::get_base_http_client,
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
        pub pages_count: i32,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Metadata {
        pub number: String,
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
        pub metadata: Metadata,
        pub read_progress: ReadProgress,
    }
}

mod komga_series {
    use super::*;
    use openidconnect::url::Url;
    use serde::{Deserialize, Serialize};

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
        /// Provided with a url this will extract the ID number from it. For example the url
        /// https://myanimelist.net/manga/116778 will extract 116778
        ///
        /// Currently only works for myanimelist and anilist as mangaupdates doesn't store the ID
        /// in the url
        ///
        /// # Arguments
        ///
        /// * `url`: The url to extact from
        ///
        /// returns: Option<String> The ID number if the extraction is successful
        fn extract_id(&self, url: String) -> Option<String> {
            if let Ok(parsed_url) = Url::parse(&url) {
                parsed_url
                    .path_segments()
                    .and_then(|segments| segments.collect::<Vec<_>>().get(1).cloned())
                    .map(String::from)
            } else {
                None
            }
        }

        /// Extracts the list of providers with a MediaSource,ID Tuple
        ///
        /// Currently only works for myanimelist and anilist as mangaupdates doesn't store the ID
        /// in the url
        ///
        /// Requires that the metadata is stored with the label anilist or myanimelist other
        /// spellings wont work
        ///
        /// returns: Vec<(Option<MediaSource>,Option<String>)> list of providers with a
        ///          MediaSource,ID Tuple
        pub fn find_providers(&self) -> Vec<(Option<MediaSource>, Option<String>)> {
            let mut provider_links = vec![];
            for link in self.links.iter() {
                let source;

                // NOTE: mangaupdates doesnt work here because the ID isnt in the url
                match link.label.to_lowercase().as_str() {
                    "anilist" => source = Some(MediaSource::Anilist),
                    "myanimelist" => source = Some(MediaSource::Mal),
                    _ => continue,
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

mod komga_events {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct Data {
        pub book_id: String,
        pub user_id: String,
    }
}

struct KomgaEventHandler {
    task: OnceLock<()>,
    receiver: Mutex<Option<UnboundedReceiver<komga_events::Data>>>,
}

impl KomgaEventHandler {
    pub const fn new() -> Self {
        Self {
            task: OnceLock::new(),
            receiver: Mutex::new(None),
        }
    }

    pub fn get_receiver(&self) -> &Mutex<Option<UnboundedReceiver<komga_events::Data>>> {
        &self.receiver
    }

    pub fn get_task(&self) -> &OnceLock<()> {
        &self.task
    }
}

impl IntegrationService {
    /// Generates the sse listener for komga. This is intended to be run from another thread
    /// if you run this in the main thread it will lock it up
    ///
    /// # Arguments
    ///
    /// * `sender`: The unbounded sender, lifetime of this sender is the lifetime of this
    ///             function so the sender doesn't need global lifetime
    /// * `base_url`: URL for komga
    /// * `cookie`: The komga cookie with the remember-me included
    ///
    /// returns: Never Returns
    async fn sse_listener(
        sender: mpsc::UnboundedSender<komga_events::Data>,
        base_url: String,
        cookie: String,
    ) -> anyhow::Result<(), Box<dyn std::error::Error>> {
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

                // We could also handle ReadProgressDeleted here but I don't
                // think we want to handle any deletions like this
                if event.event == "ReadProgressChanged" {
                    match serde_json::from_str::<komga_events::Data>(&event.data) {
                        Ok(read_progress) => {
                            if sender.send(read_progress).is_err() {
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
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
        }
    }

    /// Fetches an API request to the provided client URL like
    /// `https://acme.com/api_endpoint/api_id`
    ///
    /// # Arguments
    ///
    /// * `client`: Prepopulated client please use `get_base_http_client` to construct this
    /// * `cookie`: The komga cookie with the remember-me included
    /// * `api_endpoint`: Endpoint which comes after the base_url doesn't require a prepended `/`
    /// * `api_id`: The ID of the object you are searching for added to the end of the
    ///             api_endpoint doesn't require a prepended `/`
    ///
    /// returns: Result<T, Error> This only preforms basic error handling on the json parsing
    async fn fetch_api<T: DeserializeOwned>(
        client: &reqwest::Client,
        cookie: &str,
        api_endpoint: &str,
        api_id: &str,
    ) -> Result<T> {
        client
            .get(format!("{}/{}", api_endpoint, api_id))
            .header("Cookie", cookie)
            .send()
            .await?
            .error_for_status()?
            .json::<T>()
            .await
            .map_err(|e| anyhow!("Failed to parse JSON: {}", e))
    }

    /// Finds the metadata provider and ID of the provided series
    ///
    /// # Arguments
    ///
    /// * `series`: The series object from which we want to grab the provider from. There
    ///             should be a links section which is populated with urls from which we
    ///             can extract the series ID. If not a simple search of the db for a manga with
    ///             the same title will be preformed
    /// * `provider`: The preferred provider if this isn't available another will be used
    ///               in its place
    /// * `db`: The metadata db connection
    ///
    /// returns: Result<(Option<MediaSource>, Option<String>), Error> This contains the mediasource
    ///          and the ID of the series.
    async fn find_provider_and_id(
        series: &komga_series::Item,
        provider: MediaSource,
        db: &DatabaseConnection,
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
            return Decimal::zero();
        }

        let percentage = (curr_page as f64 / total_page as f64) * 100.0;

        Decimal::from_f64(percentage).unwrap_or(Decimal::zero())
    }

    /// Processes the events which are provided by the receiver
    ///
    /// # Arguments
    ///
    /// * `base_url`: URL for komga
    /// * `cookie`: The komga cookie with the remember-me included
    /// * `provider`: The preferred provider if this isn't available another will be used
    ///               in its place
    /// * `data`: The data from the event
    ///
    /// returns: Option<IntegrationMediaSeen> If the event had no issues processing contains the
    ///          media which was read otherwise none
    async fn process_events(
        &self,
        base_url: &str,
        cookie: &str,
        provider: MediaSource,
        data: komga_events::Data,
    ) -> Option<IntegrationMediaSeen> {
        let client = get_base_http_client(&format!("{}/api/v1/", base_url), None);

        let book: komga_book::Item = Self::fetch_api(&client, cookie, "books", &data.book_id)
            .await
            .ok()?;
        let series: komga_series::Item =
            Self::fetch_api(&client, cookie, "series", &book.series_id)
                .await
                .ok()?;

        let (source, id) = Self::find_provider_and_id(&series, provider, &self.db)
            .await
            .ok()?;

        let Some(id) = id else {
            tracing::debug!(
                "No MAL URL or database entry found for manga: {}",
                series.name
            );
            return None;
        };

        Some(IntegrationMediaSeen {
            identifier: id,
            lot: MediaLot::Manga,
            source: source.unwrap(),
            manga_chapter_number: Some(book.metadata.number.parse().unwrap_or_default()),
            progress: Self::calculate_percentage(book.read_progress.page, book.media.pages_count),
            provider_watched_on: Some("Komga".to_string()),
            ..Default::default()
        })
    }

    pub async fn komga_progress(
        &self,
        base_url: &str,
        cookie: &str,
        provider: MediaSource,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        // This object needs global lifetime so we can continue to use the receiver
        // If we ever create more SSE Objects we may want to implement a higher level
        // Controller or make a housekeeping function to make sure the background
        // threads are running correctly and kill them when the app is killed
        // (though rust should handle this)
        static SSE_LISTS: KomgaEventHandler = KomgaEventHandler::new();

        let mutex_receiver = SSE_LISTS.get_receiver();
        let mut receiver = {
            let mut guard = mutex_receiver.lock().unwrap();
            guard.take()
        };

        if receiver.is_none() {
            let (tx, rx) = mpsc::unbounded_channel::<komga_events::Data>();
            receiver = Some(rx);

            let base_url = base_url.to_string();
            let cookie = cookie.to_string();
            let mutex_task = SSE_LISTS.get_task();

            mutex_task.get_or_init(|| {
                tokio::spawn(async move {
                    if let Err(e) = IntegrationService::sse_listener(tx, base_url, cookie).await {
                        tracing::error!("SSE listener error: {}", e);
                    }
                });
            });
        }

        // Use hashmap here so we dont dupe pulls for a single book
        let mut unique_media_items: HashMap<String, IntegrationMediaSeen> = HashMap::new();

        if let Some(mut recv) = receiver {
            loop {
                match recv.try_recv() {
                    Ok(event) => {
                        tracing::debug!("Received event {:?}", event);
                        match unique_media_items.entry(event.book_id.clone()) {
                            Entry::Vacant(entry) => {
                                if let Some(processed_event) = self
                                    .process_events(base_url, cookie, provider, event.clone())
                                    .await
                                {
                                    entry.insert(processed_event);
                                } else {
                                    tracing::warn!(
                                        "Failed to process event for book_id: {}",
                                        event.book_id
                                    );
                                }
                            }
                            _ => continue,
                        }
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(e) => return Err(anyhow::anyhow!("Receiver error: {}", e)),
                }
            }

            // Put the receiver back
            mutex_receiver.lock().unwrap().replace(recv);
        }

        let mut media_items: Vec<IntegrationMediaSeen> = unique_media_items.into_values().collect();
        media_items.sort_by(|a, b| a.manga_chapter_number.cmp(&b.manga_chapter_number));
        tracing::debug!("Media Items: {:?}", media_items);

        Ok((media_items, vec![]))
    }
}
