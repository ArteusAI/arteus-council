import asyncio
import os
from dotenv import load_dotenv
from gigachat import GigaChat
from gigachat.models import Chat, Messages

# Load environment variables from .env
load_dotenv()

GIGACHAT_CREDENTIALS = os.getenv("GIGACHAT_CREDENTIALS")
GIGACHAT_SCOPE = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
GIGACHAT_VERIFY_SSL = os.getenv("GIGACHAT_VERIFY_SSL", "False").lower() == "true"

async def test_standalone():
    if not GIGACHAT_CREDENTIALS:
        print("ERROR: GIGACHAT_CREDENTIALS not found in .env file")
        return

    print(f"Connecting to GigaChat with scope: {GIGACHAT_SCOPE}")
    print(f"Verify SSL: {GIGACHAT_VERIFY_SSL}")
    
    try:
        async with GigaChat(
            credentials=GIGACHAT_CREDENTIALS,
            scope=GIGACHAT_SCOPE,
            verify_ssl_certs=GIGACHAT_VERIFY_SSL
        ) as giga:
            payload = Chat(
                model="GigaChat-2-Max",
                messages=[
                    Messages(role="user", content="Hello! Who are you?")
                ]
            )
            
            print("Sending request...")
            response = await giga.achat(payload)
            
            if response and response.choices:
                print("\nSUCCESS!")
                print(f"Response: {response.choices[0].message.content}")
            else:
                print("\nFAILED: Empty response from GigaChat.")
                
    except Exception as e:
        print(f"\nERROR: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test_standalone())
