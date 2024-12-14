use anyhow::{anyhow, Result};
use async_trait::async_trait;
use common_models::SearchDetails;
use common_utils::TEMP_DIR;
use dependent_models::SearchResults;
use enums::{MediaLot, MediaSource};
use media_models::{
    MetadataDetails, MetadataImageForMediaDetails, MetadataSearchItem, MusicSpecifics,
    PartialMetadataPerson,
};
use rustypipe::{
    client::{RustyPipe, RustyPipeQuery},
    param::{Language, LANGUAGES},
};
use traits::{MediaProvider, MediaProviderLanguages};

pub struct YoutubeMusicService {
    client: RustyPipeQuery,
}

impl YoutubeMusicService {
    pub async fn new() -> Self {
        let client = RustyPipe::builder().storage_dir(TEMP_DIR).build().unwrap();
        Self {
            client: client.query(),
        }
    }
}

impl MediaProviderLanguages for YoutubeMusicService {
    fn supported_languages() -> Vec<String> {
        LANGUAGES.iter().map(|l| l.name().to_owned()).collect()
    }

    fn default_language() -> String {
        Language::En.name().to_owned()
    }
}

#[async_trait]
impl MediaProvider for YoutubeMusicService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details = self
            .client
            .music_details(identifier)
            .await
            .map_err(|e| anyhow!(e))?;
        Ok(MetadataDetails {
            lot: MediaLot::Music,
            title: details.track.name,
            identifier: details.track.id,
            source: MediaSource::YoutubeMusic,
            group_identifiers: details.track.album.into_iter().map(|a| a.id).collect(),
            music_specifics: Some(MusicSpecifics {
                duration: details.track.duration.map(|d| d.try_into().unwrap()),
            }),
            url_images: details
                .track
                .cover
                .into_iter()
                .rev()
                .map(|t| MetadataImageForMediaDetails { image: t.url })
                .collect(),
            people: details
                .track
                .artists
                .into_iter()
                .filter_map(|a| {
                    a.id.map(|id| PartialMetadataPerson {
                        name: a.name,
                        identifier: id,
                        character: None,
                        source_specifics: None,
                        role: "Artist".to_string(),
                        source: MediaSource::YoutubeMusic,
                    })
                })
                .collect(),
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let results = self
            .client
            .music_search_tracks(query)
            .await
            .map_err(|e| anyhow!(e))?;
        let data = SearchResults {
            details: SearchDetails {
                total: 1,
                next_page: None,
            },
            items: results
                .items
                .items
                .into_iter()
                .map(|i| MetadataSearchItem {
                    title: i.name,
                    identifier: i.id,
                    publish_year: None,
                    image: i.cover.last().map(|t| t.url.to_owned()),
                })
                .collect(),
        };
        Ok(data)
    }
}
