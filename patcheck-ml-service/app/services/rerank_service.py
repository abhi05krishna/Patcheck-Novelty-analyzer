from sentence_transformers import CrossEncoder

RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"

_reranker: CrossEncoder | None = None


def load_reranker() -> CrossEncoder:
    """
    Loads once per process, same pattern as the embedding model. First
    call downloads the model from Hugging Face; cached after that.

    NOT the same model as embedding_service.py's SentenceTransformer --
    a CrossEncoder scores a (query, candidate) PAIR jointly in one
    forward pass, rather than embedding each independently and comparing
    vectors. That's slower per comparison, which is exactly why it only
    runs on the ~20 candidates FAISS already narrowed down, never on the
    full corpus.
    """
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder(RERANKER_MODEL)
    return _reranker


import math


def rerank_texts(query: str, candidate_texts: list[str]) -> list[float]:
    """
    Scores every candidate against the query. Returns SIGMOID-NORMALIZED
    scores in [0, 1], SAME ORDER as candidate_texts.

    ms-marco cross-encoders output raw, UNBOUNDED logits -- confirmed in
    production (real scores of 3.40, 3.09, 2.17 seen on real queries),
    not the [0,1] probability the rest of the pipeline assumes. Applying
    sigmoid here, once, at the source, means every caller gets a properly
    bounded relevance score -- rather than each caller separately
    guessing how to handle it (the previous approach, clamping to
    [0,1] in Node, silently collapsed every score above 1 into a flat
    1.0, destroying the actual ranking signal between confidently-
    relevant candidates).
    """
    if not candidate_texts:
        return []

    model = load_reranker()
    pairs = [[query, text] for text in candidate_texts]
    raw_scores = model.predict(pairs)
    return [1 / (1 + math.exp(-float(s))) for s in raw_scores]
