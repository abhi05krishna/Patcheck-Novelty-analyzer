from sentence_transformers import SentenceTransformer
from app.config import settings

_model = None


def load_model():
    """Loads the embedding model once per process. First call downloads
    weights from Hugging Face Hub and caches them locally; subsequent
    runs are offline."""
    global _model
    if _model is None:
        _model = SentenceTransformer(settings.embedding_model)
    return _model


def embed_texts(texts):
    """Batch-embeds a list of strings. normalize_embeddings=True makes
    cosine similarity equivalent to inner product, which is what
    faiss_service.py's IndexFlatIP assumes."""
    model = load_model()
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return vectors.tolist()