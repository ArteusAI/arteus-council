import asyncio
import os
import sys
from pathlib import Path

# Add the project root to sys.path to allow relative imports
sys.path.append(str(Path(__file__).parent))

from backend.council import stage1_collect_responses
from backend.config import COUNCIL_MODELS

async def test_council_stage1():
    print("Testing Council Stage 1 with GigaChat...")
    # Only test GigaChat to save time/tokens
    models = ["gigachat/GigaChat-2-Max"]
    user_query = "What are the main advantages of using a 3-stage LLM council?"
    
    print(f"Querying models: {models}")
    results = await stage1_collect_responses(user_query, models=models)
    
    if results:
        print("\nSUCCESS!")
        for res in results:
            print(f"Model: {res['model']}")
            print(f"Response (first 100 chars): {res['response'][:100]}...")
    else:
        print("\nFAILED: No results returned from Stage 1.")

if __name__ == "__main__":
    asyncio.run(test_council_stage1())
