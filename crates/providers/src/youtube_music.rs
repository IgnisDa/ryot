use anyhow::Result;
use async_trait::async_trait;
use common_models::{SearchDetails, StoredUrl};
use common_utils::TEMP_DIR;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::SearchResults;
use enums::{MediaLot, MediaSource};
use media_models::{
    MetadataDetails, MetadataGroupSearchItem, MetadataImage, MetadataImageForMediaDetails,
    MetadataSearchItem, MusicSpecifics, PartialMetadataPerson, PartialMetadataWithoutId,
};
use rustypipe::{
    client::{RustyPipe, RustyPipeQuery},
    model::richtext::ToHtml,
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
        let details = self.client.music_details(identifier).await?;
        let suggestions = if let Some(related_id) = details.related_id {
            let related = self.client.music_related(related_id).await?;
            related
                .tracks
                .into_iter()
                .map(|t| PartialMetadataWithoutId {
                    title: t.name,
                    identifier: t.id,
                    lot: MediaLot::Music,
                    is_recommendation: None,
                    source: MediaSource::YoutubeMusic,
                    image: t.cover.last().map(|c| c.url.to_owned()),
                })
                .collect()
        } else {
            vec![]
        };
        Ok(MetadataDetails {
            suggestions,
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
        let results = self.client.music_search_tracks(query).await?;
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

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let album = self.client.music_album(identifier).await?;
        Ok((
            MetadataGroupWithoutId {
                title: album.name,
                lot: MediaLot::Music,
                identifier: album.id,
                display_images: vec![],
                source: MediaSource::YoutubeMusic,
                parts: album.tracks.len().try_into().unwrap(),
                description: album.description.map(|d| d.to_html()),
                images: album
                    .cover
                    .into_iter()
                    .rev()
                    .map(|c| MetadataImage {
                        url: StoredUrl::Url(c.url),
                    })
                    .collect(),
            },
            album
                .tracks
                .into_iter()
                .map(|t| PartialMetadataWithoutId {
                    title: t.name,
                    identifier: t.id,
                    lot: MediaLot::Music,
                    is_recommendation: None,
                    source: MediaSource::YoutubeMusic,
                    image: t.cover.last().map(|t| t.url.to_owned()),
                })
                .collect(),
        ))
    }

    async fn metadata_group_search(
        &self,
        query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let data = self.client.music_search_albums(query).await?;
        Ok(SearchResults {
            details: SearchDetails {
                total: 1,
                next_page: None,
            },
            items: data
                .items
                .items
                .into_iter()
                .map(|t| MetadataGroupSearchItem {
                    parts: None,
                    name: t.name,
                    identifier: t.id,
                    image: t.cover.last().map(|t| t.url.to_owned()),
                })
                .collect(),
        })
    }
}
