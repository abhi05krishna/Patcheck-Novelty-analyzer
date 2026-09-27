from fastembed import TextEmbedding
from app.config import settings

_model: TextEmbedding | None = None


def load_model() -> TextEmbedding:
    """Loads the embedding model once per process. First call downloads
    ONNX weights from Hugging Face Hub and caches them locally;
    subsequent runs are offline.

    Uses fastembed instead of sentence-transformers specifically to
    avoid the torch dependency -- torch alone consumes 300-400MB+ RAM
    on import, which is what caused this service to hit Render's
    free-tier 512MB memory limit. fastembed runs the same class of
    model via ONNX Runtime, no PyTorch involved."""
    global _model
    if _model is None:
        _model = TextEmbedding(model_name=settings.embedding_model)
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embeds a list of strings. fastembed's TextEmbedding.embed()
    returns L2-normalized vectors by default for supported models,
    which is what faiss_service.py's IndexFlatIP assumes (cosine
    similarity via inner product) -- if you ever change models, confirm
    the new one is still normalized, or normalize explicitly here."""
    model = load_model()
    embeddings = list(model.embed(texts))
    return [e.tolist() for e in embeddings]