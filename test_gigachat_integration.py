import asyncio
import os
import sys
from pathlib import Path

# Add the project root to sys.path to allow relative imports
sys.path.append(str(Path(__file__).parent))

from backend.llm import query_model
from backend.config import COUNCIL_MODELS

async def test_gigachat():
    print("Testing GigaChat model...")
    model = "gigachat/GigaChat-2-Max"
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello, who are you? Answer in one short sentence."}
    ]
    
    print(f"Querying model: {model}")
    response = await query_model(model, messages)
    
    if response:
        print("\nSUCCESS!")
        print(f"Content: {response.get('content')}")
    else:
        print("\nFAILED: No response received. Check logs for errors.")

if __name__ == "__main__":
    asyncio.run(test_gigachat())
