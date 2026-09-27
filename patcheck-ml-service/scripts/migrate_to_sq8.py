"""
One-off migration: rebuilds the existing FAISS index (IndexFlatIP,
full float32) as a scalar-quantized (8-bit) index instead, to cut
RAM usage roughly 4x. Reuses already-computed vectors -- no
re-embedding, no Mongo access needed. Run once, locally, before
redeploying.

Usage: python scripts/migrate_to_sq8.py
"""
import json
import os
import sys
import numpy as np
import faiss

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.config import settings

INDEX_PATH = os.path.join(settings.index_dir, "index.faiss")
MAPPING_PATH = os.path.join(settings.index_dir, "id_mapping.json")
BACKUP_INDEX_PATH = INDEX_PATH + ".flatip.bak"


def main():
    print(f"Loading existing index from {INDEX_PATH}...")
    old_index = faiss.read_index(INDEX_PATH)
    n = old_index.ntotal
    dim = old_index.d
    print(f"Loaded: {n} vectors, dimension {dim}")

    with open(MAPPING_PATH, "r") as f:
        mapping_data = json.load(f)

    print("Reconstructing all vectors from the old index (this may take a minute)...")
    # old_index is an IndexIDMap2 wrapping IndexFlatIP -- reconstruct_n
    # pulls vectors back out by their original int64 ids, not by
    # position, since ids may not be contiguous after any past removals.
    all_ids = list(range(mapping_data["next_id"]))
    valid_ids = [i for i in all_ids if str(i) in mapping_data["mapping"]]

    vectors = np.zeros((len(valid_ids), dim), dtype=np.float32)
    for row, int_id in enumerate(valid_ids):
        vectors[row] = old_index.reconstruct(int_id)

    print(f"Reconstructed {len(valid_ids)} vectors.")

    print("Backing up old index...")
    os.rename(INDEX_PATH, BACKUP_INDEX_PATH)

    print("Building new scalar-quantized (8-bit) index...")
    quantizer = faiss.IndexScalarQuantizer(dim, faiss.ScalarQuantizer.QT_8bit, faiss.METRIC_INNER_PRODUCT)
    new_index = faiss.IndexIDMap2(quantizer)

    print("Training quantizer on real vector distribution...")
    quantizer.train(vectors)

    print("Adding vectors under their ORIGINAL ids (mapping.json stays valid, unchanged)...")
    ids_array = np.array(valid_ids, dtype=np.int64)
    new_index.add_with_ids(vectors, ids_array)

    print(f"Writing new index to {INDEX_PATH}...")
    faiss.write_index(new_index, INDEX_PATH)

    print(f"Done. {new_index.ntotal} vectors in new SQ8 index.")
    print(f"Old float32 index backed up at {BACKUP_INDEX_PATH} -- delete once you've confirmed the new one works.")


if __name__ == "__main__":
    main()