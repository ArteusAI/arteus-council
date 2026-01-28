"""Firecrawl API client for scraping URLs."""

import asyncio
import re
import logging
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from .config import FIRECRAWL_API_KEY

logger = logging.getLogger("llm-council.firecrawl")

FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"

URL_PATTERN = re.compile(
    r'(?:https?://)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:/[^\s<>\[\]()"\',;]*)?(?<![.,;:!?\)])',
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


async def scrape_url_direct(url: str, timeout: float = 30.0) -> ScrapedLink:
    """
    Fallback scraper using direct HTTP request and BeautifulSoup.

    Args:
        url: The URL to scrape
        timeout: Request timeout in seconds

    Returns:
        ScrapedLink with extracted content
    """
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()

            soup = BeautifulSoup(response.content, 'lxml')

            for script in soup(["script", "style", "nav", "footer", "header"]):
                script.decompose()

            title = None
            if soup.title:
                title = soup.title.string
            elif soup.find("meta", property="og:title"):
                title = soup.find("meta", property="og:title").get("content")

            description = None
            meta_desc = soup.find("meta", attrs={"name": "description"})
            if meta_desc:
                description = meta_desc.get("content")
            elif soup.find("meta", property="og:description"):
                description = soup.find("meta", property="og:description").get("content")

            og_image = None
            og_img = soup.find("meta", property="og:image")
            if og_img:
                og_image = og_img.get("content")

            text_content = soup.get_text(separator='\n', strip=True)
            lines = [line.strip() for line in text_content.splitlines() if line.strip()]
            markdown = '\n\n'.join(lines)

            logger.info(f"Direct scrape of {url}: {len(markdown)} chars")

            return ScrapedLink(
                url=url,
                success=True,
                title=title,
                description=description,
                og_image=og_image,
                markdown=markdown,
            )

    except httpx.TimeoutException:
        logger.error(f"Timeout in direct scrape of {url}")
        return ScrapedLink(url=url, success=False)
    except Exception as e:
        logger.error(f"Error in direct scrape of {url}: {type(e).__name__}: {e}")
        return ScrapedLink(url=url, success=False)


async def scrape_url(url: str, timeout: float = 30.0) -> ScrapedLink:
    """
    Scrape a URL using Firecrawl API with fallback to direct scraping.

    Args:
        url: The URL to scrape
        timeout: Request timeout in seconds

    Returns:
        ScrapedLink with metadata and content
    """
    if not FIRECRAWL_API_KEY:
        logger.warning("FIRECRAWL_API_KEY not set, using direct scraping")
        return await scrape_url_direct(url, timeout)

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
                logger.warning(f"Firecrawl returned success=false for {url}, trying direct scrape")
                return await scrape_url_direct(url, timeout)

    except httpx.TimeoutException:
        logger.error(f"Timeout scraping {url} via Firecrawl, trying direct scrape")
        return await scrape_url_direct(url, timeout)
    except Exception as e:
        logger.error(f"Error scraping {url} via Firecrawl: {type(e).__name__}: {e}, trying direct scrape")
        return await scrape_url_direct(url, timeout)


def extract_urls(text: str) -> list[str]:
    """Extract unique URLs from text and normalize them."""
    urls = URL_PATTERN.findall(text)
    # Add https:// prefix to URLs without protocol
    normalized_urls = []
    for url in urls:
        if not url.startswith(('http://', 'https://')):
            normalized_urls.append(f'https://{url}')
        else:
            normalized_urls.append(url)
    return list(dict.fromkeys(normalized_urls))


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
