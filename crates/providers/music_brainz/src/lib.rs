use std::collections::HashSet;

use anyhow::Result;
use async_trait::async_trait;
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::{PAGE_SIZE, USER_AGENT_STR, compute_next_page};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{
    MetadataGroupPersonRelated, MetadataPersonRelated, MetadataSearchSourceSpecifics,
    PersonDetails, SearchResults,
};
use enum_models::{MediaLot, MediaSource};
use media_models::{
    CommitMetadataGroupInput, MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem,
    MusicSpecifics, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use musicbrainz_rs::{
    Browse, Fetch, FetchCoverart, Search,
    client::MusicBrainzClient,
    entity::{
        artist::{Artist, ArtistSearchQuery},
        recording::{Recording, RecordingSearchQuery},
        release::Release,
        release_group::{ReleaseGroup, ReleaseGroupSearchQuery},
    },
};
use traits::MediaProvider;

mod helpers;

use crate::helpers::{
    artist_description, choose_release, coverart_url_from_response, extract_publish_date,
    release_group_description,
};

static MUSICBRAINZ_BASE_URL: &str = "https://musicbrainz.org";

pub struct MusicBrainzService {
    client: MusicBrainzClient,
}

impl MusicBrainzService {
    pub fn new() -> Result<Self> {
        let mut client = MusicBrainzClient::default();
        client.set_user_agent(USER_AGENT_STR)?;
        Ok(Self { client })
    }

    async fn fetch_coverart_url_for_release(&self, release_id: &str) -> Option<String> {
        let response = Release::fetch_coverart()
            .id(release_id)
            .front()
            .res_1200()
            .execute_with_client(&self.client)
            .await
            .ok();
        if let Some(url) = response.and_then(coverart_url_from_response) {
            return Some(url);
        }

        Release::fetch_coverart()
            .id(release_id)
            .execute_with_client(&self.client)
            .await
            .ok()
            .and_then(coverart_url_from_response)
    }

    async fn fetch_coverart_url_for_release_group(&self, release_group_id: &str) -> Option<String> {
        let response = ReleaseGroup::fetch_coverart()
            .id(release_group_id)
            .front()
            .res_1200()
            .execute_with_client(&self.client)
            .await
            .ok();
        if let Some(url) = response.and_then(coverart_url_from_response) {
            return Some(url);
        }

        ReleaseGroup::fetch_coverart()
            .id(release_group_id)
            .execute_with_client(&self.client)
            .await
            .ok()
            .and_then(coverart_url_from_response)
    }

    async fn find_coverart_url_for_releases(&self, releases: &[Release]) -> Option<String> {
        for release in releases {
            if let Some(url) = self.fetch_coverart_url_for_release(&release.id).await {
                return Some(url);
            }
        }

        for release in releases {
            if let Some(release_group) = release.release_group.as_ref()
                && let Some(url) = self
                    .fetch_coverart_url_for_release_group(&release_group.id)
                    .await
            {
                return Some(url);
            }
        }

        None
    }
}

#[async_trait]
impl MediaProvider for MusicBrainzService {
    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let offset = page.saturating_sub(1).saturating_mul(PAGE_SIZE);
        let query = RecordingSearchQuery::query_builder()
            .recording(query)
            .build();
        let results = Recording::search(query)
            .limit(PAGE_SIZE as u8)
            .offset(u16::try_from(offset).unwrap_or(u16::MAX))
            .execute_with_client(&self.client)
            .await?;
        let total_items = results.count.max(0) as u64;
        let next_page = compute_next_page(page, total_items);

        let items = results
            .entities
            .into_iter()
            .map(|recording| {
                let (_, publish_year) = extract_publish_date(recording.first_release_date.as_ref());
                MetadataSearchItem {
                    image: None,
                    publish_year,
                    title: recording.title,
                    identifier: recording.id,
                }
            })
            .collect();

        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let recording = Recording::fetch()
            .id(identifier)
            .with_artists()
            .with_releases()
            .with_isrcs()
            .execute_with_client(&self.client)
            .await?;
        let (publish_date, publish_year) =
            extract_publish_date(recording.first_release_date.as_ref());

        let artist_credit = recording.artist_credit.clone().unwrap_or_default();
        let by_various_artists = artist_credit.len() > 1;
        let people = artist_credit
            .iter()
            .map(|credit| PartialMetadataPerson {
                role: "Artist".to_string(),
                name: credit.artist.name.clone(),
                source: MediaSource::MusicBrainz,
                identifier: credit.artist.id.clone(),
                ..Default::default()
            })
            .collect();

        let releases = recording.releases.clone().unwrap_or_default();
        let cover_url = self.find_coverart_url_for_releases(&releases).await;

        let mut seen_groups = HashSet::new();
        let groups = releases
            .iter()
            .filter_map(|release| release.release_group.as_ref())
            .filter(|release_group| seen_groups.insert(release_group.id.clone()))
            .map(|release_group| CommitMetadataGroupInput {
                name: release_group.title.clone(),
                unique: UniqueMediaIdentifier {
                    lot: MediaLot::Music,
                    source: MediaSource::MusicBrainz,
                    identifier: release_group.id.clone(),
                },
                ..Default::default()
            })
            .collect();

        Ok(MetadataDetails {
            groups,
            people,
            publish_date,
            publish_year,
            title: recording.title,
            source_url: Some(format!("{MUSICBRAINZ_BASE_URL}/recording/{identifier}")),
            assets: EntityAssets {
                remote_images: cover_url.into_iter().collect(),
                ..Default::default()
            },
            music_specifics: Some(MusicSpecifics {
                duration: recording.length.map(|length| (length / 1000) as i32),
                by_various_artists: Some(by_various_artists),
                ..Default::default()
            }),
            ..Default::default()
        })
    }

    async fn metadata_group_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let offset = page.saturating_sub(1).saturating_mul(PAGE_SIZE);
        let query = ReleaseGroupSearchQuery::query_builder()
            .release_group(query)
            .build();
        let results = ReleaseGroup::search(query)
            .limit(PAGE_SIZE as u8)
            .offset(u16::try_from(offset).unwrap_or(u16::MAX))
            .execute_with_client(&self.client)
            .await?;
        let total_items = results.count.max(0) as u64;
        let next_page = compute_next_page(page, total_items);

        let items = results
            .entities
            .into_iter()
            .map(|group| MetadataGroupSearchItem {
                name: group.title,
                identifier: group.id,
                ..Default::default()
            })
            .collect();

        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let release_group = ReleaseGroup::fetch()
            .id(identifier)
            .with_artists()
            .execute_with_client(&self.client)
            .await?;
        let browse_results = Release::browse()
            .by_release_group(identifier)
            .execute_with_client(&self.client)
            .await?;
        let release = choose_release(&browse_results.entities);
        let (_publish_date, publish_year) =
            extract_publish_date(release_group.first_release_date.as_ref());

        let mut items = Vec::new();
        let mut cover_url = None;

        if let Some(release) = release {
            cover_url = self.fetch_coverart_url_for_release(&release.id).await;
            let release = Release::fetch()
                .id(&release.id)
                .with_recordings()
                .with_artist_credits()
                .execute_with_client(&self.client)
                .await?;

            if let Some(media) = release.media.as_ref() {
                for medium in media {
                    if let Some(tracks) = medium.tracks.as_ref() {
                        for track in tracks {
                            let recording = match track.recording.as_ref() {
                                Some(recording) => recording,
                                None => continue,
                            };
                            let title = if track.title.is_empty() {
                                recording.title.clone()
                            } else {
                                track.title.clone()
                            };
                            items.push(PartialMetadataWithoutId {
                                title,
                                publish_year,
                                lot: MediaLot::Music,
                                identifier: recording.id.clone(),
                                source: MediaSource::MusicBrainz,
                                image: cover_url.clone(),
                            });
                        }
                    }
                }
            }
        }
        if cover_url.is_none() {
            cover_url = self
                .fetch_coverart_url_for_release_group(&release_group.id)
                .await;
        }

        let release_group_id = release_group.id.clone();
        let release_group_title = release_group.title.clone();
        let release_group_desc = release_group_description(&release_group);
        let group = MetadataGroupWithoutId {
            lot: MediaLot::Music,
            parts: items.len() as i32,
            title: release_group_title,
            description: release_group_desc,
            source: MediaSource::MusicBrainz,
            identifier: release_group_id.clone(),
            source_url: Some(format!(
                "{MUSICBRAINZ_BASE_URL}/release-group/{release_group_id}"
            )),
            assets: EntityAssets {
                remote_images: cover_url.into_iter().collect(),
                ..Default::default()
            },
            ..Default::default()
        };

        Ok((group, items))
    }

    async fn people_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let offset = page.saturating_sub(1).saturating_mul(PAGE_SIZE);
        let query = ArtistSearchQuery::query_builder().artist(query).build();
        let results = Artist::search(query)
            .limit(PAGE_SIZE as u8)
            .offset(u16::try_from(offset).unwrap_or(u16::MAX))
            .execute_with_client(&self.client)
            .await?;
        let total_items = results.count.max(0) as u64;
        let next_page = compute_next_page(page, total_items);

        let items = results
            .entities
            .into_iter()
            .map(|artist| PeopleSearchItem {
                name: artist.name,
                identifier: artist.id,
                ..Default::default()
            })
            .collect();

        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let artist = Artist::fetch()
            .id(identifier)
            .with_aliases()
            .with_release_groups()
            .execute_with_client(&self.client)
            .await?;
        let recordings = Recording::browse()
            .by_artist(identifier)
            .execute_with_client(&self.client)
            .await?;

        let related_metadata_groups = artist
            .release_groups
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|group| {
                let group_id = group.id.clone();
                let group_title = group.title.clone();
                let description = release_group_description(&group);
                let source_url = Some(format!("{MUSICBRAINZ_BASE_URL}/release-group/{group_id}"));
                MetadataGroupPersonRelated {
                    role: "Artist".to_string(),
                    metadata_group: MetadataGroupWithoutId {
                        source_url,
                        description,
                        title: group_title,
                        identifier: group_id,
                        lot: MediaLot::Music,
                        source: MediaSource::MusicBrainz,
                        ..Default::default()
                    },
                }
            })
            .collect();

        let related_metadata = recordings
            .entities
            .into_iter()
            .map(|recording| MetadataPersonRelated {
                role: "Artist".to_string(),
                metadata: PartialMetadataWithoutId {
                    lot: MediaLot::Music,
                    title: recording.title,
                    identifier: recording.id,
                    source: MediaSource::MusicBrainz,
                    ..Default::default()
                },
                ..Default::default()
            })
            .collect();

        let artist_name = artist.name.clone();
        let description = artist_description(&artist);

        Ok(PersonDetails {
            description,
            related_metadata,
            name: artist_name,
            related_metadata_groups,
            source_url: Some(format!("{MUSICBRAINZ_BASE_URL}/artist/{identifier}")),
            ..Default::default()
        })
    }
}
