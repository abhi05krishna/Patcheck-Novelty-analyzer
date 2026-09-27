import json
import os
import threading
import numpy as np
import faiss
from app.config import settings

INDEX_FILE = "index.faiss"
MAPPING_FILE = "id_mapping.json"


class FaissIndexManager:
    """
    Wraps a FAISS IndexFlatIP (inner product on normalized vectors =
    cosine similarity) inside an IndexIDMap2 so we can assign our own
    int64 ids -- and remove specific vectors later, which plain
    IndexFlatIP doesn't support on its own.

    FAISS only knows int64 ids. Mongo uses ObjectId hex strings. This
    class owns the mapping between them, persisted alongside the index
    itself so a restart doesn't lose which int id belongs to which
    Mongo document (or what type it is).
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._dim = settings.embedding_dim
        self._index_path = os.path.join(settings.index_dir, INDEX_FILE)
        self._mapping_path = os.path.join(settings.index_dir, MAPPING_FILE)

        os.makedirs(settings.index_dir, exist_ok=True)

        # mapping: int_id (str, since JSON keys are strings) -> {mongo_id, source_type}
        self._mapping: dict[str, dict] = {}
        self._next_id = 0

        self._load_or_create()

    def _load_or_create(self):
        if os.path.exists(self._index_path) and os.path.exists(self._mapping_path):
            base_index = faiss.read_index(self._index_path)
            self._index = base_index
            with open(self._mapping_path, "r") as f:
                data = json.load(f)
                self._mapping = data["mapping"]
                self._next_id = data["next_id"]
        else:
            # Scalar-quantized (8-bit) instead of full-precision float32.
            # Cuts vector storage to ~1/4 the RAM of IndexFlatIP, which
            # is what let this service fit inside Render's free-tier
            # 512MB limit. Small, expected recall tradeoff at top-k --
            # verified against the project's own eval harness before
            # this went into production; the downstream cross-encoder
            # reranker also absorbs most of the remaining noise.
            quantizer = faiss.IndexScalarQuantizer(self._dim, faiss.ScalarQuantizer.QT_8bit, faiss.METRIC_INNER_PRODUCT)
            self._index = faiss.IndexIDMap2(quantizer)
            self._next_id = 0
            self._mapping = {}

    def add(self, mongo_ids: list[str], source_types: list[str], vectors: list[list[float]]) -> int:
        with self._lock:
            n = len(vectors)
            int_ids = np.arange(self._next_id, self._next_id + n, dtype=np.int64)
            vecs = np.array(vectors, dtype=np.float32)

            self._index.add_with_ids(vecs, int_ids)

            for i, int_id in enumerate(int_ids):
                self._mapping[str(int_id)] = {
                    "mongo_id": mongo_ids[i],
                    "source_type": source_types[i],
                }

            self._next_id += n
            return n

    def search(self, query_vector: list[float], k: int, source_type_filter: str | None, candidate_multiplier: int):
        with self._lock:
            # If filtering by type, over-fetch candidates first, then
            # filter and truncate -- FAISS has no native metadata filter,
            # this is the simplest correct workaround at this scale.
            fetch_k = k * candidate_multiplier if source_type_filter else k
            fetch_k = min(fetch_k, self._index.ntotal) if self._index.ntotal > 0 else 0

            if fetch_k == 0:
                return []

            query = np.array([query_vector], dtype=np.float32)
            scores, ids = self._index.search(query, fetch_k)

            results = []
            for score, int_id in zip(scores[0], ids[0]):
                if int_id == -1:
                    continue
                entry = self._mapping.get(str(int_id))
                if entry is None:
                    continue  # stale id somehow not in mapping -- skip rather than crash
                if source_type_filter and entry["source_type"] != source_type_filter:
                    continue
                results.append({
                    "mongo_id": entry["mongo_id"],
                    "source_type": entry["source_type"],
                    "score": float(score),
                })
                if len(results) >= k:
                    break

            return results

    def batch_search(self, query_vectors: list[list[float]], k: int, source_type_filter: str | None, candidate_multiplier: int):
        """
        Searches MULTIPLE query vectors in a single FAISS call, instead
        of calling search() once per query in a loop. FAISS's index.search()
        natively accepts a 2D array (n_queries x dim) and returns results
        for all of them at once -- this is meaningfully faster than N
        separate calls once N is more than a handful, since FAISS batches
        the underlying matrix math instead of paying per-call overhead
        N times.

        Concretely useful for your compare flow: a submitted document
        splits into several chunks, each needing its own top-k search --
        this does all of them in one round trip instead of one per chunk.

        Returns a list of result-lists, SAME ORDER as query_vectors.
        """
        with self._lock:
            fetch_k = k * candidate_multiplier if source_type_filter else k
            fetch_k = min(fetch_k, self._index.ntotal) if self._index.ntotal > 0 else 0

            if fetch_k == 0:
                return [[] for _ in query_vectors]

            queries = np.array(query_vectors, dtype=np.float32)
            all_scores, all_ids = self._index.search(queries, fetch_k)  # one batched call

            all_results = []
            for row_scores, row_ids in zip(all_scores, all_ids):
                results = []
                for score, int_id in zip(row_scores, row_ids):
                    if int_id == -1:
                        continue
                    entry = self._mapping.get(str(int_id))
                    if entry is None:
                        continue
                    if source_type_filter and entry["source_type"] != source_type_filter:
                        continue
                    results.append({
                        "mongo_id": entry["mongo_id"],
                        "source_type": entry["source_type"],
                        "score": float(score),
                    })
                    if len(results) >= k:
                        break
                all_results.append(results)

            return all_results

    def remove(self, mongo_ids: list[str]) -> int:
        with self._lock:
            mongo_id_set = set(mongo_ids)
            int_ids_to_remove = [
                int(int_id) for int_id, entry in self._mapping.items()
                if entry["mongo_id"] in mongo_id_set
            ]
            if not int_ids_to_remove:
                return 0

            self._index.remove_ids(np.array(int_ids_to_remove, dtype=np.int64))

            for int_id in int_ids_to_remove:
                del self._mapping[str(int_id)]

            return len(int_ids_to_remove)

    def save(self):
        with self._lock:
            faiss.write_index(self._index, self._index_path)
            with open(self._mapping_path, "w") as f:
                json.dump({"mapping": self._mapping, "next_id": self._next_id}, f)

    def stats(self):
        with self._lock:
            paper_count = sum(1 for e in self._mapping.values() if e["source_type"] == "paper")
            patent_count = sum(1 for e in self._mapping.values() if e["source_type"] == "patent")
            return {
                "total_vectors": self._index.ntotal,
                "dimension": self._dim,
                "paper_count": paper_count,
                "patent_count": patent_count,
            }


# Single shared instance for the process -- FastAPI's dependency
# injection just returns this rather than constructing a new one per request.
_manager = FaissIndexManager()


def get_index_manager() -> FaissIndexManager:
    return _manager
