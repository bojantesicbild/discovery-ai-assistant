"""RAGFlow REST API client — wraps document parsing, search, and GraphRAG."""

import httpx
from typing import Optional
from app.config import settings


class RAGFlowClient:
    def __init__(self, base_url: str = None, api_key: str = None):
        self.base_url = (base_url or settings.ragflow_url).rstrip("/")
        self.api_key = api_key or settings.ragflow_api_key
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=60.0,
            )
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    # ── Dataset operations ────────────────────────────

    async def create_dataset(self, name: str, chunk_method: str = "naive") -> dict:
        client = await self._get_client()
        resp = await client.post("/api/v1/datasets", json={
            "name": name,
            "chunk_method": chunk_method,
            "language": "English",
        })
        resp.raise_for_status()
        return resp.json()

    async def list_datasets(self) -> list[dict]:
        client = await self._get_client()
        resp = await client.get("/api/v1/datasets")
        resp.raise_for_status()
        return resp.json().get("data", [])

    async def get_or_create_dataset(self, name: str, chunk_method: str = "naive") -> str:
        datasets = await self.list_datasets()
        for ds in datasets:
            if ds.get("name") == name:
                return ds["id"]
        result = await self.create_dataset(name, chunk_method)
        return result.get("data", {}).get("id", "")

    # ── Document operations ───────────────────────────

    async def upload_document(self, dataset_id: str, filename: str, content: bytes) -> dict:
        client = await self._get_client()
        files = {"file": (filename, content)}
        resp = await client.post(f"/api/v1/datasets/{dataset_id}/documents", files=files)
        resp.raise_for_status()
        return resp.json()

    async def parse_document(self, dataset_id: str, document_ids: list[str]) -> dict:
        client = await self._get_client()
        resp = await client.post(f"/api/v1/datasets/{dataset_id}/chunks", json={
            "document_ids": document_ids,
        })
        resp.raise_for_status()
        return resp.json()

    async def get_document_status(self, dataset_id: str, document_id: str) -> dict:
        client = await self._get_client()
        resp = await client.get(f"/api/v1/datasets/{dataset_id}/documents/{document_id}")
        resp.raise_for_status()
        return resp.json()

    # ── Search ────────────────────────────────────────

    async def search(self, dataset_id: str, query: str, top_n: int = 10,
                     similarity_threshold: float = 0.3) -> list[dict]:
        client = await self._get_client()
        resp = await client.post("/api/v1/retrieval", json={
            "dataset_ids": [dataset_id],
            "question": query,
            "top_k": top_n,
            "similarity_threshold": similarity_threshold,
        })
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", {}).get("chunks", [])

    # ── GraphRAG ──────────────────────────────────────

    async def trigger_graph_extraction(self, dataset_id: str) -> dict:
        client = await self._get_client()
        resp = await client.post(f"/api/v1/datasets/{dataset_id}/knowledge_graph")
        resp.raise_for_status()
        return resp.json()

    async def search_graph(self, dataset_id: str, query: str) -> dict:
        client = await self._get_client()
        resp = await client.get(f"/api/v1/datasets/{dataset_id}/knowledge_graph", params={"query": query})
        resp.raise_for_status()
        return resp.json()


# Singleton
ragflow_client = RAGFlowClient()
