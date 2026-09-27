from fastembed.rerank.cross_encoder import TextCrossEncoder

RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"

_reranker: TextCrossEncoder | None = None


def load_reranker() -> TextCrossEncoder:
    """
    Loads once per process, same pattern as the embedding model.
    fastembed's TextCrossEncoder runs the ONNX port of the same
    ms-marco cross-encoder model this service always used -- no
    PyTorch dependency, unlike the original sentence-transformers
    CrossEncoder.
    """
    global _reranker
    if _reranker is None:
        _reranker = TextCrossEncoder(model_name=RERANKER_MODEL)
    return _reranker


def rerank_texts(query: str, candidate_texts: list[str]) -> list[float]:
    """
    Scores every candidate against the query, same order as
    candidate_texts.

    NOTE: fastembed's TextCrossEncoder.rerank() score range has NOT
    been independently verified here -- the previous
    sentence-transformers version produced unbounded raw logits
    (confirmed in production: 3.40, 3.09, 2.17), requiring a manual
    sigmoid to get [0,1]. Test this against real output before
    trusting it: print raw scores on a real query/candidate pair. If
    they're already in [0,1], remove the sigmoid below. If they're
    still unbounded logits, keep it.
    """
    if not candidate_texts:
        return []

    model = load_reranker()
    raw_scores = list(model.rerank(query, candidate_texts))

    import math
    return [1 / (1 + math.exp(-float(s))) for s in raw_scores]