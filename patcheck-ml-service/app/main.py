from fastapi import FastAPI, Depends, HTTPException
from app.schemas import (
    EmbedRequest, EmbedResponse,
    IndexAddRequest, IndexAddResponse,
    SearchRequest, SearchResponse, SearchResultItem,
    RemoveRequest, RemoveResponse,
    StatsResponse,
    IngestRequest, IngestResponse, IngestChunk,
    BatchSearchRequest, BatchSearchResponse,
    RerankRequest, RerankResponse, RerankResultItem,
    PrepareRequest, PrepareResponse, PrepareChunk,
    BatchSearchVectorsRequest
)
from app.services.embedding_service import embed_texts, load_model
from app.services.chunking_service import semantic_chunk
from app.services.faiss_service import FaissIndexManager, get_index_manager
from app.services.rerank_service import rerank_texts, load_reranker

app = FastAPI(title="PatCheck ML Service")


@app.on_event("startup")
def warm_up():
    # Load both models at startup, not on first request -- otherwise
    # whichever endpoint gets hit first pays a multi-second model-load
    # cost that looks like a broken/slow endpoint rather than a one-time
    # startup cost. Two separate models (embedding + cross-encoder),
    # both worth warming up before real traffic arrives.
    load_model()
    load_reranker()


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if not req.texts:
        raise HTTPException(400, "texts must be a non-empty list")
    vectors = embed_texts(req.texts)
    return EmbedResponse(embeddings=vectors)


@app.post("/index/add", response_model=IndexAddResponse)
def add_to_index(req: IndexAddRequest, manager: FaissIndexManager = Depends(get_index_manager)):
    if not req.items:
        raise HTTPException(400, "items must be a non-empty list")

    texts = [item.text for item in req.items]
    vectors = embed_texts(texts)

    mongo_ids = [item.mongo_id for item in req.items]
    source_types = [item.source_type for item in req.items]

    added = manager.add(mongo_ids, source_types, vectors)
    return IndexAddResponse(added=added)


@app.post("/index/search", response_model=SearchResponse)
def search_index(req: SearchRequest, manager: FaissIndexManager = Depends(get_index_manager)):
    query_vector = embed_texts([req.text])[0]
    raw_results = manager.search(
        query_vector, req.k, req.source_type_filter, req.candidate_multiplier
    )
    results = [SearchResultItem(**r) for r in raw_results]
    return SearchResponse(results=results)


@app.post("/index/remove", response_model=RemoveResponse)
def remove_from_index(req: RemoveRequest, manager: FaissIndexManager = Depends(get_index_manager)):
    removed = manager.remove(req.mongo_ids)
    return RemoveResponse(removed=removed)


@app.post("/index/save")
def save_index(manager: FaissIndexManager = Depends(get_index_manager)):
    # No auto-save on every add -- that would fsync the whole index file
    # on every single insert, which is slow at ingestion scale. Call this
    # explicitly after a batch (e.g. every N papers in your ingestion
    # script, and always at the end of a run).
    manager.save()
    return {"status": "saved"}


@app.get("/index/stats", response_model=StatsResponse)
def index_stats(manager: FaissIndexManager = Depends(get_index_manager)):
    return StatsResponse(**manager.stats())


@app.post("/ingest", response_model=IngestResponse)
def ingest_document(req: IngestRequest, manager: FaissIndexManager = Depends(get_index_manager)):
    """
    One-shot: semantic-chunk the text, embed each chunk, add every
    chunk's vector to FAISS, and return the chunk list so the caller
    (your Node ingestion script) can write matching metadata rows to
    MongoDB using the SAME ids -- no second round trip needed to agree
    on ids, since they're derived deterministically from parent_id here.
    """
    chunks = semantic_chunk(req.text)
    if not chunks:
        raise HTTPException(400, "text produced no chunks (empty or unparseable)")

    texts = [c["chunk"] for c in chunks]
    vectors = embed_texts(texts)

    chunk_ids = [f"{req.parent_id}::chunk::{i}" for i in range(len(chunks))]
    source_types = [req.source_type] * len(chunks)

    manager.add(chunk_ids, source_types, vectors)

    return IngestResponse(chunks=[
        IngestChunk(chunk_id=chunk_ids[i], chunk_number=i, text=texts[i])
        for i in range(len(chunks))
    ])


@app.post("/index/search/batch", response_model=BatchSearchResponse)
def batch_search_index(req: BatchSearchRequest, manager: FaissIndexManager = Depends(get_index_manager)):
    """
    Same as /index/search, but for multiple query texts in one call --
    embeds all of them in one batch, then does a single FAISS
    multi-query search instead of looping. Use this for the compare
    flow: a submitted document's several chunks all get searched here
    in one round trip, not one request per chunk.
    """
    if not req.texts:
        raise HTTPException(400, "texts must be a non-empty list")

    query_vectors = embed_texts(req.texts)
    raw_results = manager.batch_search(
        query_vectors, req.k, req.source_type_filter, req.candidate_multiplier
    )
    results = [[SearchResultItem(**r) for r in group] for group in raw_results]
    return BatchSearchResponse(results=results)


@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest):
    """
    Re-scores a set of candidates (e.g. FAISS search results) against
    the query using a cross-encoder, which reads query and candidate
    TOGETHER instead of comparing independent vectors -- catches cases
    where cosine similarity ranked something highly for surface-level
    reasons. Only run this on a small candidate set (the ~20 FAISS
    already narrowed down), never the full corpus -- it's meaningfully
    slower per comparison than embedding similarity.
    """
    if not req.candidates:
        raise HTTPException(400, "candidates must be a non-empty list")

    texts = [c.text for c in req.candidates]
    scores = rerank_texts(req.query, texts)

    combined = [
        {"mongo_id": c.mongo_id, "text": c.text, "rerank_score": s}
        for c, s in zip(req.candidates, scores)
    ]
    combined.sort(key=lambda x: x["rerank_score"], reverse=True)

    if req.top_n:
        combined = combined[:req.top_n]

    return RerankResponse(results=[RerankResultItem(**c) for c in combined])


@app.post("/prepare", response_model=PrepareResponse)
def prepare_document(req: PrepareRequest):
    """
    Chunks and embeds text WITHOUT adding it to FAISS -- for a user's
    submitted document being COMPARED against the corpus, not added to
    it. Same chunking+embedding logic as /ingest, minus the indexing
    step. Returns chunk text alongside each embedding so the caller
    doesn't have to re-derive which vector belongs to which chunk.
    """
    chunks = semantic_chunk(req.text)
    if not chunks:
        raise HTTPException(400, "text produced no chunks (empty or unparseable)")

    texts = [c["chunk"] for c in chunks]
    vectors = embed_texts(texts)

    return PrepareResponse(chunks=[
        PrepareChunk(text=texts[i], embedding=vectors[i])
        for i in range(len(chunks))
    ])


@app.post("/index/search/batch/vectors", response_model=BatchSearchResponse)
def batch_search_by_vectors(req: BatchSearchVectorsRequest, manager: FaissIndexManager = Depends(get_index_manager)):
    """
    Same as /index/search/batch, but takes PRECOMPUTED vectors instead
    of text -- use this after /prepare so the same chunk never gets
    embedded twice in one compare request.
    """
    if not req.vectors:
        raise HTTPException(400, "vectors must be a non-empty list")

    raw_results = manager.batch_search(
        req.vectors, req.k, req.source_type_filter, req.candidate_multiplier
    )
    results = [[SearchResultItem(**r) for r in group] for group in raw_results]
    return BatchSearchResponse(results=results)


@app.get("/health")
def health():
    return {"status": "ok"}
