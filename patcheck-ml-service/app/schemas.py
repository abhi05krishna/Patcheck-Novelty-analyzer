from typing import List, Literal, Optional
from pydantic import BaseModel


class EmbedRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]


class IndexItem(BaseModel):
    # mongo_id is a string (Mongo ObjectId hex) -- FAISS itself only
    # accepts int64 ids, so faiss_service.py maintains the mapping.
    mongo_id: str
    text: str
    source_type: Literal["paper", "patent"]


class IndexAddRequest(BaseModel):
    items: List[IndexItem]


class IndexAddResponse(BaseModel):
    added: int


class SearchRequest(BaseModel):
    text: str
    k: int = 5
    source_type_filter: Optional[Literal["paper", "patent"]] = None
    # over-fetch factor used when a filter is set, since post-filtering
    # after retrieval shrinks the result count -- see faiss_service.search()
    candidate_multiplier: int = 4


class SearchResultItem(BaseModel):
    mongo_id: str
    source_type: str
    score: float


class SearchResponse(BaseModel):
    results: List[SearchResultItem]


class RemoveRequest(BaseModel):
    mongo_ids: List[str]


class RemoveResponse(BaseModel):
    removed: int


class StatsResponse(BaseModel):
    total_vectors: int
    dimension: int
    paper_count: int
    patent_count: int


class IngestRequest(BaseModel):
    # parent_id is the Mongo _id of the Paper (or later, Patent) document.
    # Chunk ids are derived from it deterministically -- see main.py --
    # so Node never has to round-trip a chunk id back before storing it.
    parent_id: str
    source_type: Literal["paper", "patent"]
    text: str
    file_name: str


class IngestChunk(BaseModel):
    chunk_id: str
    chunk_number: int
    text: str


class IngestResponse(BaseModel):
    chunks: List[IngestChunk]


class BatchSearchRequest(BaseModel):
    texts: List[str]
    k: int = 5
    source_type_filter: Optional[Literal["paper", "patent"]] = None
    candidate_multiplier: int = 4


class BatchSearchResponse(BaseModel):
    # one results-list per input text, SAME ORDER as the request's `texts`
    results: List[List[SearchResultItem]]

class PrepareRequest(BaseModel):
    text: str


class PrepareChunk(BaseModel):
    text: str
    embedding: List[float]


class PrepareResponse(BaseModel):
    chunks: List[PrepareChunk]


class BatchSearchVectorsRequest(BaseModel):
    # for when embeddings are already computed (e.g. from /prepare) --
    # avoids embedding the same text twice
    vectors: List[List[float]]
    k: int = 5
    source_type_filter: Optional[Literal["paper", "patent"]] = None
    candidate_multiplier: int = 4


class RerankCandidate(BaseModel):
    mongo_id: str
    text: str


class RerankRequest(BaseModel):
    query: str
    candidates: List[RerankCandidate]
    top_n: Optional[int] = None  # None = return all, reranked and sorted


class RerankResultItem(BaseModel):
    mongo_id: str
    text: str
    rerank_score: float


class RerankResponse(BaseModel):
    results: List[RerankResultItem]
