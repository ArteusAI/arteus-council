import asyncio
import os
import sys
from pathlib import Path

# Add the project root to sys.path to allow relative imports
sys.path.append(str(Path(__file__).parent))

from backend.llm import query_model
from backend.config import YANDEX_API_KEY, YANDEX_FOLDER_ID

async def test_yandex():
    print("Testing YandexGPT model...")
    if not YANDEX_API_KEY or not YANDEX_FOLDER_ID:
        print("ERROR: YANDEX_API_KEY or YANDEX_FOLDER_ID not found in environment variables.")
        return

    model = "yandex/aliceai-llm"
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello, who are you? Answer in one short sentence in Russian."}
    ]
    
    print(f"Querying model: {model}")
    print(f"Folder ID: {YANDEX_FOLDER_ID}")
    
    response = await query_model(model, messages)
    
    if response:
        print("\nSUCCESS!")
        print(f"Content: {response.get('content')}")
    else:
        print("\nFAILED: No response received. Check logs for errors.")

if __name__ == "__main__":
    asyncio.run(test_yandex())
