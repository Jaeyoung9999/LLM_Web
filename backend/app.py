from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import openai
import json
import asyncio

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

@app.get("/ask_query")
async def ask_query(request: Request, prompt: str) -> StreamingResponse:
    async def stream_openai_response():
        try:
            stream = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="gpt-3.5-turbo",
                stream=True,
            )

            # Using the Server-Sent Events format
            for chunk in stream:
                # 클라이언트 연결이 끊어졌는지 확인
                if await request.is_disconnected():
                    print("Client disconnected, stopping LLM generation")
                    break
                
                content = chunk.choices[0].delta.content or ""
                if content:
                    # Ensure newlines are preserved in the JSON string
                    data = json.dumps({"status": "processing", "data": content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                    # Small delay to allow frontend processing and connection check
                    await asyncio.sleep(0.01)
            
            # 연결이 여전히 유지되고 있을 때만 완료 신호 전송
            if not await request.is_disconnected():
                # Signal completion without sending "Stream finished" text
                yield f"data: {json.dumps({'status': 'complete', 'data': ''}, ensure_ascii=False)}\n\n"
                yield "event: complete\ndata: \n\n"
            
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