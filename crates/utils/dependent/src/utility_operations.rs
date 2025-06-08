use async_graphql::Result;
use database_models::prelude::{
    Collection, Metadata, MetadataGroup, Person, Workout, WorkoutTemplate,
};
use enum_models::EntityLot;
use sea_orm::EntityTrait;
use std::sync::Arc;
use supporting_service::SupportingService;

pub async fn get_entity_title_from_id_and_lot(
    id: &String,
    lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let obj_title = match lot {
        EntityLot::Metadata => Metadata::find_by_id(id).one(&ss.db).await?.unwrap().title,
        EntityLot::MetadataGroup => {
            MetadataGroup::find_by_id(id)
                .one(&ss.db)
                .await?
                .unwrap()
                .title
        }
        EntityLot::Person => Person::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::Collection => Collection::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::Exercise => id.clone(),
        EntityLot::Workout => Workout::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::WorkoutTemplate => {
            WorkoutTemplate::find_by_id(id)
                .one(&ss.db)
                .await?
                .unwrap()
                .name
        }
        EntityLot::Review | EntityLot::UserMeasurement => {
            unreachable!()
        }
    };
    Ok(obj_title)
}
