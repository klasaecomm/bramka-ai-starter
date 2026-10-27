#!/usr/bin/env python3
"""Atrapa serwera modeli do testów lokalnych: Anthropic Messages (/v1/messages), Responses (/v1/responses)
i lista modeli (/v1/models). Każde żądanie dopisuje do logu: ścieżkę, model, liczbę wiadomości, teksty
ze znacznikiem PYTANIE/ODP oraz to, czy nagłówki niosły oczekiwany token testowy (bez wypisywania go)."""
import json, sys, http.server

PORT, LOG = int(sys.argv[1]), sys.argv[2]
TOKEN = sys.argv[3] if len(sys.argv) > 3 else ""


def teksty(wiadomosci):
    out = []
    for m in wiadomosci or []:
        c = m.get("content")
        for b in ([{"text": c}] if isinstance(c, str) else c or []):
            t = b.get("text") if isinstance(b, dict) else None
            if t and ("PYTANIE" in t or "ODP" in t):
                out.append(t.strip()[-30:])
    return out


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def tokeny(self):
        return {"bearer": self.headers.get("authorization") == "Bearer " + TOKEN,
                "x_api_key": self.headers.get("x-api-key") == TOKEN}

    def do_GET(self):
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"object": "list", "models": [],
                                     "data": [{"id": "gpt-test"}, {"id": "gpt-test-mini"}, {"id": "claude-cos"}]}).encode())

    def do_POST(self):
        dane = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        wiad = dane.get("messages") if "messages" in dane else dane.get("input")
        with open(LOG, "a") as f:
            f.write(json.dumps({"sciezka": self.path.split("?")[0], "model": dane.get("model"), "n": len(wiad or []),
                                "teksty": teksty(wiad), "token": self.tokeny()}, ensure_ascii=False) + "\n")
        if "count_tokens" in self.path:
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers()
            self.wfile.write(b'{"input_tokens":10}'); return
        odp = "ODP-%d" % len(wiad or [])
        self.send_response(200); self.send_header("content-type", "text/event-stream"); self.end_headers()

        def ev(typ, d):
            self.wfile.write(("event: %s\ndata: %s\n\n" % (typ, json.dumps(d))).encode()); self.wfile.flush()
        if self.path.startswith("/v1/responses"):
            ev("response.created", {"type": "response.created", "response": {"id": "resp_1"}})
            ev("response.output_item.done", {"type": "response.output_item.done", "item": {
                "type": "message", "role": "assistant", "id": "msg_1", "content": [{"type": "output_text", "text": odp}]}})
            ev("response.completed", {"type": "response.completed", "response": {"id": "resp_1", "usage": {
                "input_tokens": 1, "input_tokens_details": None, "output_tokens": 1, "output_tokens_details": None, "total_tokens": 2}}})
            return
        uz = {"input_tokens": 5, "output_tokens": 1}
        ev("message_start", {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant",
                             "model": dane.get("model"), "content": [], "stop_reason": None, "stop_sequence": None, "usage": uz}})
        ev("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
        ev("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": odp}})
        ev("content_block_stop", {"type": "content_block_stop", "index": 0})
        ev("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 3}})
        ev("message_stop", {"type": "message_stop"})


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
