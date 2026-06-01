from abc import ABC, abstractmethod
from ..models import DocumentRecord


class BaseConnector(ABC):
    @abstractmethod
    def list_filings(self, symbol: str, doc_types: list[str]) -> list[DocumentRecord]:
        """Return document metadata without downloading content."""

    @abstractmethod
    def download_pdf(self, url: str) -> bytes:
        """Download filing content as raw bytes."""
