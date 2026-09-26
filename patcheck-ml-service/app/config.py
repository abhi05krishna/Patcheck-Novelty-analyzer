from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dim: int = 384
    index_dir: str = "./data/faiss_index"

    class Config:
        env_file = ".env"


settings = Settings()