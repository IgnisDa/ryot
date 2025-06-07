use std::{cmp::Reverse, collections::HashMap};

use async_graphql::Result;
use common_models::SearchDetails;
use database_models::{
    metadata_group_to_person, metadata_to_genre, metadata_to_metadata_group, metadata_to_person,
    prelude::{
        Genre, MetadataGroup, MetadataGroupToPerson, MetadataToGenre, MetadataToMetadataGroup,
        MetadataToPerson, Person,
    },
};
use database_utils::{transform_entity_assets, user_by_id};
use dependent_models::{
    GenreDetails, GraphqlPersonDetails, MetadataBaseData, MetadataGroupDetails, SearchResults,
};
use dependent_utils::generic_metadata;
use itertools::Itertools;
use media_models::{
    GenreDetailsInput, GenreListItem, GraphqlMetadataDetails, GraphqlMetadataGroup,
    PersonDetailsGroupedByRole, PersonDetailsItemWithCharacter,
};
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, PaginatorTrait, QueryFilter, QueryOrder,
};
use supporting_service::SupportingService;

pub async fn person_details(
    person_id: String,
    supporting_service: &std::sync::Arc<SupportingService>,
) -> Result<GraphqlPersonDetails> {
    let mut details = Person::find_by_id(person_id.clone())
        .one(&supporting_service.db)
        .await?
        .unwrap();
    transform_entity_assets(&mut details.assets, supporting_service).await;
    let metadata_associations = MetadataToPerson::find()
        .filter(metadata_to_person::Column::PersonId.eq(&person_id))
        .order_by_asc(metadata_to_person::Column::Index)
        .all(&supporting_service.db)
        .await?;
    let mut metadata_contents: HashMap<_, Vec<_>> = HashMap::new();
    for assoc in metadata_associations {
        let to_push = PersonDetailsItemWithCharacter {
            character: assoc.character,
            entity_id: assoc.metadata_id,
        };
        metadata_contents
            .entry(assoc.role)
            .and_modify(|e| e.push(to_push.clone()))
            .or_insert(vec![to_push]);
    }
    let associated_metadata = metadata_contents
        .into_iter()
        .map(|(name, items)| PersonDetailsGroupedByRole {
            count: items.len(),
            name,
            items,
        })
        .sorted_by_key(|f| Reverse(f.count))
        .collect_vec();
    let associated_metadata_groups = MetadataGroupToPerson::find()
        .filter(metadata_group_to_person::Column::PersonId.eq(person_id))
        .order_by_asc(metadata_group_to_person::Column::Index)
        .all(&supporting_service.db)
        .await?;
    let mut metadata_group_contents: HashMap<_, Vec<_>> = HashMap::new();
    for assoc in associated_metadata_groups {
        let to_push = PersonDetailsItemWithCharacter {
            entity_id: assoc.metadata_group_id,
            ..Default::default()
        };
        metadata_group_contents
            .entry(assoc.role)
            .and_modify(|e| e.push(to_push.clone()))
            .or_insert(vec![to_push]);
    }
    let associated_metadata_groups = metadata_group_contents
        .into_iter()
        .map(|(name, items)| PersonDetailsGroupedByRole {
            count: items.len(),
            name,
            items,
        })
        .sorted_by_key(|f| Reverse(f.count))
        .collect_vec();
    Ok(GraphqlPersonDetails {
        details,
        associated_metadata,
        associated_metadata_groups,
    })
}

pub async fn genre_details(
    supporting_service: &std::sync::Arc<SupportingService>,
    user_id: String,
    input: GenreDetailsInput,
) -> Result<GenreDetails> {
    let page = input.page.unwrap_or(1);
    let genre = Genre::find_by_id(input.genre_id.clone())
        .one(&supporting_service.db)
        .await?
        .unwrap();
    let preferences = user_by_id(&user_id, supporting_service).await?.preferences;
    let paginator = MetadataToGenre::find()
        .filter(metadata_to_genre::Column::GenreId.eq(input.genre_id))
        .paginate(&supporting_service.db, preferences.general.list_page_size);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut contents = vec![];
    for association_items in paginator.fetch_page(page - 1).await? {
        contents.push(association_items.metadata_id);
    }
    Ok(GenreDetails {
        details: GenreListItem {
            id: genre.id,
            name: genre.name,
            num_items: Some(number_of_items.try_into().unwrap()),
        },
        contents: SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages {
                    Some((page + 1).try_into().unwrap())
                } else {
                    None
                },
            },
            items: contents,
        },
    })
}

pub async fn metadata_group_details(
    supporting_service: &std::sync::Arc<SupportingService>,
    metadata_group_id: String,
) -> Result<MetadataGroupDetails> {
    let mut model = MetadataGroup::find_by_id(metadata_group_id)
        .one(&supporting_service.db)
        .await?
        .unwrap();
    transform_entity_assets(&mut model.assets, supporting_service).await;
    Ok(MetadataGroupDetails {
        details: model,
        contents: vec![],
    })
}

pub async fn metadata_details(
    supporting_service: &std::sync::Arc<SupportingService>,
    metadata_id: &String,
) -> Result<GraphqlMetadataDetails> {
    let MetadataBaseData {
        mut model,
        genres,
        creators,
        suggestions,
    } = generic_metadata(metadata_id, supporting_service).await?;

    let mut group = vec![];
    let associations = MetadataToMetadataGroup::find()
        .filter(metadata_to_metadata_group::Column::MetadataId.eq(metadata_id))
        .find_also_related(MetadataGroup)
        .all(&supporting_service.db)
        .await?;
    for association in associations {
        let grp = association.1.unwrap();
        group.push(GraphqlMetadataGroup {
            id: grp.id,
            name: grp.title,
            part: association.0.part,
        });
    }

    let watch_providers = model.watch_providers.unwrap_or_default();

    transform_entity_assets(&mut model.assets, supporting_service).await;

    let resp = GraphqlMetadataDetails {
        group,
        genres,
        creators,
        suggestions,
        id: model.id,
        lot: model.lot,
        watch_providers,
        title: model.title,
        assets: model.assets,
        source: model.source,
        is_nsfw: model.is_nsfw,
        source_url: model.source_url,
        is_partial: model.is_partial,
        identifier: model.identifier,
        description: model.description,
        publish_date: model.publish_date,
        publish_year: model.publish_year,
        book_specifics: model.book_specifics,
        show_specifics: model.show_specifics,
        movie_specifics: model.movie_specifics,
        music_specifics: model.music_specifics,
        manga_specifics: model.manga_specifics,
        anime_specifics: model.anime_specifics,
        provider_rating: model.provider_rating,
        production_status: model.production_status,
        original_language: model.original_language,
        podcast_specifics: model.podcast_specifics,
        created_by_user_id: model.created_by_user_id,
        external_identifiers: model.external_identifiers,
        video_game_specifics: model.video_game_specifics,
        audio_book_specifics: model.audio_book_specifics,
        visual_novel_specifics: model.visual_novel_specifics,
    };
    Ok(resp)
}
