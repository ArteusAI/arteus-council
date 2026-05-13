import asyncio
import os
import time
import sys
from pathlib import Path

# Add the project root to sys.path to allow relative imports
sys.path.append(str(Path(__file__).parent))

from backend.llm import query_models_parallel
from backend.config import GIGACHAT_PARALLEL_DISABLED

async def test_parallel_protection():
    print(f"Testing parallel protection. GIGACHAT_PARALLEL_DISABLED={GIGACHAT_PARALLEL_DISABLED}")
    
    # We will query the same model twice in parallel. 
    # If protection is ON, they should finish one after another.
    # If protection is OFF, they should start/run at the same time.
    models = ["gigachat/GigaChat-2-Max", "gigachat/GigaChat-2-Max"]
    messages = [{"role": "user", "content": "Tell me a short joke."}]
    
    start_time = time.time()
    results = await query_models_parallel(models, messages)
    total_duration = time.time() - start_time
    
    print(f"\nTotal duration for 2 parallel requests: {total_duration:.2f}s")
    
    if results:
        print("Both requests finished successfully.")
    else:
        print("Requests failed.")

if __name__ == "__main__":
    asyncio.run(test_parallel_protection())
