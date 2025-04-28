from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import openai
import json
import asyncio
from typing import List, Dict, Any
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Your React app's address
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai_api_key = "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"
client = openai.Client(api_key=openai_api_key)

# Define a model for the message format
class ChatMessage(BaseModel):
    role: str
    content: str

# Define a model for the request body
class ChatRequest(BaseModel):
    messages: List[ChatMessage]

@app.post("/chat")
async def chat(request: Request) -> StreamingResponse:
    # Parse the request body
    chat_request_data = await request.json()
    messages = chat_request_data.get("messages", [])
    
    async def stream_openai_response():
        try:
            # Add system message if not present
            if not any(msg["role"] == "system" for msg in messages):
                messages.insert(0, {"role": "system", "content": "You are a helpful assistant."})
            
            stream = client.chat.completions.create(
                messages=messages,
                model="gpt-3.5-turbo",
                stream=True,
            )

            for chunk in stream:
                # Check if client disconnected
                if await request.is_disconnected():
                    print("Client disconnected, stopping LLM generation")
                    break
                
                content = chunk.choices[0].delta.content or ""
                if content:
                    data = json.dumps({"status": "processing", "data": content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                    await asyncio.sleep(0.01)
            
            if not await request.is_disconnected():
                yield f"data: {json.dumps({'status': 'complete', 'data': 'Stream finished'}, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            error_data = json.dumps({"status": "error", "data": str(e)}, ensure_ascii=False)
            yield f"data: {error_data}\n\n"

    return StreamingResponse(
        stream_openai_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream"
        }
    )

# Keep the original endpoint for backward compatibility
@app.get("/ask_query")
async def ask_query(request: Request, prompt: str) -> StreamingResponse:
    async def stream_openai_response():
        try:
            stream = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."}, 
                    {"role": "user", "content": prompt}
                ],
                model="gpt-3.5-turbo",
                stream=True,
            )

            for chunk in stream:
                if await request.is_disconnected():
                    print("Client disconnected, stopping LLM generation")
                    break
                
                content = chunk.choices[0].delta.content or ""
                if content:
                    data = json.dumps({"status": "processing", "data": content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                    await asyncio.sleep(0.01)
            
            if not await request.is_disconnected():
                yield f"data: {json.dumps({'status': 'complete', 'data': 'Stream finished'}, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            error_data = json.dumps({"status": "error", "data": str(e)}, ensure_ascii=False)
            yield f"data: {error_data}\n\n"

    return StreamingResponse(
        stream_openai_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream"
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)