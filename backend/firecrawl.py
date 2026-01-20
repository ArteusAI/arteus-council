"""Firecrawl API client for scraping URLs."""

import asyncio
import re
import logging
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

import httpx

from .config import FIRECRAWL_API_KEY

logger = logging.getLogger("llm-council.firecrawl")

FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"

URL_PATTERN = re.compile(
    r'https?://[^\s<>\[\]()"\',;]+(?<![.,;:!?\)])',
    re.IGNORECASE
)


@dataclass
class ScrapedLink:
    """Structured data from a scraped URL."""

    url: str
    success: bool
    title: Optional[str] = None
    description: Optional[str] = None
    og_image: Optional[str] = None
    markdown: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "url": self.url,
            "success": self.success,
            "title": self.title,
            "description": self.description,
            "og_image": self.og_image,
            "domain": urlparse(self.url).netloc if self.url else None,
            "markdown": self.markdown,
        }


async def scrape_url(url: str, timeout: float = 30.0) -> ScrapedLink:
    """
    Scrape a URL using Firecrawl API.

    Args:
        url: The URL to scrape
        timeout: Request timeout in seconds

    Returns:
        ScrapedLink with metadata and content
    """
    if not FIRECRAWL_API_KEY:
        logger.warning("FIRECRAWL_API_KEY not set, skipping URL scraping")
        return ScrapedLink(url=url, success=False)

    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "url": url,
        "formats": ["markdown"],
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                FIRECRAWL_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            if data.get("success"):
                page_data = data.get("data", {})
                metadata = page_data.get("metadata", {})
                markdown = page_data.get("markdown", "")

                logger.info(f"Scraped {url}: {len(markdown)} chars")

                return ScrapedLink(
                    url=url,
                    success=True,
                    title=metadata.get("title"),
                    description=metadata.get("description") or metadata.get("ogDescription"),
                    og_image=metadata.get("ogImage"),
                    markdown=markdown,
                )
            else:
                logger.warning(f"Firecrawl returned success=false for {url}")
                return ScrapedLink(url=url, success=False)

    except httpx.TimeoutException:
        logger.error(f"Timeout scraping {url}")
        return ScrapedLink(url=url, success=False)
    except Exception as e:
        logger.error(f"Error scraping {url}: {type(e).__name__}: {e}")
        return ScrapedLink(url=url, success=False)


def extract_urls(text: str) -> list[str]:
    """Extract unique URLs from text."""
    urls = URL_PATTERN.findall(text)
    return list(dict.fromkeys(urls))


async def scrape_urls_parallel(urls: list[str]) -> list[ScrapedLink]:
    """
    Scrape multiple URLs in parallel.

    Args:
        urls: List of URLs to scrape

    Returns:
        List of ScrapedLink objects
    """
    tasks = [scrape_url(url) for url in urls]
    return await asyncio.gather(*tasks)


def enrich_message_with_scraped_content(
    text: str,
    scraped_links: list[ScrapedLink]
) -> str:
    """
    Enrich a message by appending scraped content for each URL.

    Args:
        text: Original message text
        scraped_links: List of ScrapedLink objects

    Returns:
        Enriched message with link content blocks appended
    """
    enriched_parts = [text]

    for link in scraped_links:
        if link.success and link.markdown:
            truncated = link.markdown[:50000] if len(link.markdown) > 50000 else link.markdown
            enriched_parts.append(
                f'\n\n<link_content url="{link.url}">\n{truncated}\n</link_content>'
            )

    return "".join(enriched_parts)


async def process_message_links(text: str) -> tuple[str, list[dict], dict[str, bool]]:
    """
    Process a message to extract and scrape URLs.

    Args:
        text: User message text

    Returns:
        Tuple of (enriched_text, link_metadata_list, scrape_status)
        where link_metadata_list contains dicts with title, description, etc.
        and scrape_status maps URL to success boolean
    """
    urls = extract_urls(text)
    if not urls:
        return text, [], {}

    scraped_links = await scrape_urls_parallel(urls)
    scrape_status = {link.url: link.success for link in scraped_links}
    link_metadata = [link.to_dict() for link in scraped_links]
    enriched = enrich_message_with_scraped_content(text, scraped_links)

    return enriched, link_metadata, scrape_status
