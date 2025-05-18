import http.server
import socketserver
import urllib.parse
import os
import json
import re

PORT = 8000
DATA_DIR = "codex/data"
TEMPLATE_DIR = "codex/templates"

os.makedirs(DATA_DIR, exist_ok=True)

class JSONHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/templates/list":
            templates = []

            try:
                for filename in os.listdir(TEMPLATE_DIR):
                    if filename.endswith(".html") or filename.endswith(".htm"):
                        filepath = os.path.join(TEMPLATE_DIR, filename)
                        with open(filepath, 'r', encoding='utf-8') as f:
                            lines = [next(f, '') for _ in range(20)]
                            metadata = self.extract_metadata(lines)

                        template_entry = {"filename": os.path.splitext(filename)[0]}
                        template_entry.update(metadata)
                        templates.append(template_entry)

                self.respond(200, templates)
            except Exception as e:
                self.send_error(500, f"Server error: {str(e)}")
        else:
            super().do_GET()

    def extract_metadata(self, lines):
        metadata = {}
        meta_pattern = re.compile(r'@([\w-]+):\s*(.+)')
        for line in lines:
            if '@' in line:
                match = meta_pattern.search(line)
                if match:
                    key = match.group(1).lower()
                    value = match.group(2).strip()
                    metadata[key] = value
        return metadata
    
    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_path.query)
        action = parsed_path.path.strip("/")
        file_name = query.get("file", [None])[0]
        key = query.get("key", [None])[0]

        if not file_name or not file_name.endswith(".json"):
            self.send_error(400, "Missing or invalid 'file' parameter")
            return

        file_path = os.path.join(DATA_DIR, file_name)

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        try:
            data = json.loads(body) if body else None
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON body")
            return

        try:
            if action == "write":
                if os.path.exists(file_path):
                    with open(file_path, "r") as f:
                        existing = json.load(f)

                    if isinstance(existing, list) and isinstance(data, list):
                        existing.extend(data)
                    elif isinstance(existing, dict) and isinstance(data, dict):
                        existing.update(data)
                    else:
                        self.send_error(400, "Data types do not match for write/append")
                        return
                else:
                    existing = data  # Create new content

                with open(file_path, "w") as f:
                    json.dump(existing, f, indent=2)
                self.respond(200, {"status": "File created or updated"})

            elif action == "replace":
                if key is None:
                    self.send_error(400, "Missing 'key' parameter for replace")
                    return

                with open(file_path, "r") as f:
                    obj = json.load(f)
                if not isinstance(obj, dict):
                    self.send_error(400, "Replace only supports JSON objects")
                    return
                obj[key] = data

                with open(file_path, "w") as f:
                    json.dump(obj, f, indent=2)
                self.respond(200, {"status": f"Replaced key '{key}'"})

            elif action == "remove_key":
                if key is None:
                    self.send_error(400, "Missing 'key' parameter for remove_key")
                    return

                with open(file_path, "r") as f:
                    obj = json.load(f)
                if not isinstance(obj, dict):
                    self.send_error(400, "Cannot remove key from non-dict JSON")
                    return
                if key in obj:
                    del obj[key]
                    with open(file_path, "w") as f:
                        json.dump(obj, f, indent=2)
                    self.respond(200, {"status": f"Key '{key}' removed"})
                else:
                    self.send_error(404, f"Key '{key}' not found")

            elif action == "delete":
                os.remove(file_path)
                self.respond(200, {"status": "File deleted"})

            else:
                self.send_error(404, f"Unknown action: {action}")

        except FileNotFoundError:
            self.send_error(404, "File not found")
        except Exception as e:
            self.send_error(500, f"Server error: {str(e)}")

    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode("utf-8"))

    def translate_path(self, path):
        """Serve files from current directory (./), not ./data/"""
        return super().translate_path(path)

# Run server
if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), JSONHandler) as httpd:
        print(f"Serving at http://localhost:{PORT}")
        httpd.serve_forever()
