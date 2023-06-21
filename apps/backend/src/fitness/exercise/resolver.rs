use sea_orm::DatabaseConnection;

#[derive(Debug, Clone)]
pub struct ExerciseService {
    db: DatabaseConnection,
}
