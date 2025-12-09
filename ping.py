import os
import json
import sys
import httpx

LOCAL_URL = os.getenv("LOCAL_OPENAI_URL", "http://localhost:4141/v1/completions")
API_KEY = os.getenv("OPENAI_API_KEY")  # optional if your local server doesn't need auth
MODEL = os.getenv("OPENAI_MODEL", "text-davinci-003")

def stream_completion(prompt: str):
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"

    payload = {
        "model": MODEL,
        "prompt": prompt,
        "max_tokens": 200,
        "temperature": 0.7,
        "stream": True
    }

    with httpx.stream("POST", LOCAL_URL, headers=headers, json=payload, timeout=None) as resp:
        resp.raise_for_status()
        for raw_line in resp.iter_lines():
            if not raw_line:
                continue
            line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
            line = line.strip()
            # common SSE style: "data: {...}" or "data: [DONE]"
            if line.startswith("data:"):
                data = line[len("data:"):].strip()
            else:
                data = line

            if not data:
                continue
            if data == "[DONE]":
                break

            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                # not JSON; print raw chunk
                print(data, end="", flush=True)
                continue

            # Try to extract text for legacy completions format
            text = None
            if "choices" in obj and isinstance(obj["choices"], list) and obj["choices"]:
                choice = obj["choices"][0]
                # new chunks may have 'delta' or direct 'text'
                if "delta" in choice and isinstance(choice["delta"], dict):
                    text = choice["delta"].get("content") or choice["delta"].get("text")
                else:
                    text = choice.get("text") or choice.get("content")
            elif "text" in obj:
                text = obj["text"]

            if text:
                print(text, end="", flush=True)

if __name__ == "__main__":
    prompt = "public static void main(String[] "
    if len(sys.argv) > 1:
        prompt = " ".join(sys.argv[1:])
    print(prompt, end="")
    stream_completion(prompt)