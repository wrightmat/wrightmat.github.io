import http.server
import socketserver
import urllib.parse
import os
import json
import re
from pathlib import Path

PORT = 8000

# Define directory mappings
DIRECTORIES = {
    "characters": "sheet/characters",
    "templates": "sheet/templates",
    "schemas": "sheet/schemas",
    "data": "codex/data"
}

# Ensure all directories exist
for dir_path in DIRECTORIES.values():
    os.makedirs(dir_path, exist_ok=True)

class JSONHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/list/"):
            directory = self.path.split("/list/")[1]
            if directory in DIRECTORIES:
                try:
                    dir_path = DIRECTORIES[directory]
                    files = [f for f in os.listdir(dir_path) if f.endswith('.json')]
                    file_list = [f.replace('.json', '') for f in files]
                    self.respond(200, file_list)
                except Exception as e:
                    self.send_error(500, f"Error listing directory: {str(e)}")
            else:
            	self.send_error(400, f"Invalid directory: {directory}")
        elif self.path == "/templates/list":
            templates = []
            template_dir = DIRECTORIES.get("templates", ".")

            try:
                for filename in os.listdir(template_dir):
                    if filename.endswith(".html") or filename.endswith(".htm"):
                        filepath = os.path.join(template_dir, filename)
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
        
        # Extract parameters
        file_name = query.get("file", [None])[0]
        key = query.get("key", [None])[0]
        directory = query.get("dir", ["data"])[0]  # Default to 'data' for backward compatibility
        
        # Validate directory
        if directory not in DIRECTORIES:
            self.send_error(400, f"Invalid directory '{directory}'. Valid options: {list(DIRECTORIES.keys())}")
            return
            
        if not file_name or not file_name.endswith(".json"):
            self.send_error(400, "Missing or invalid 'file' parameter")
            return

        # Get the correct directory path
        base_dir = DIRECTORIES[directory]
        file_path = os.path.join(base_dir, file_name)

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        try:
            data = json.loads(body) if body else None
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON body")
            return

        try:
            if action == "write":
                # For templates, characters, and schemas, we typically want to replace the entire file
                if directory in ["templates", "characters", "schemas"]:
                    with open(file_path, "w") as f:
                        json.dump(data, f, indent=2)
                    self.respond(200, {"status": f"File {file_name} saved to {directory}", "path": file_path})
                else:
                    # Original append/merge behavior for data directory
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
                        existing = data

                    with open(file_path, "w") as f:
                        json.dump(existing, f, indent=2)
                    self.respond(200, {"status": "File created or updated", "path": file_path})

            elif action == "replace":
                if key is None:
                    self.send_error(400, "Missing 'key' parameter for replace")
                    return

                if not os.path.exists(file_path):
                    self.send_error(404, "File not found")
                    return

                with open(file_path, "r") as f:
                    obj = json.load(f)
                if not isinstance(obj, dict):
                    self.send_error(400, "Replace only supports JSON objects")
                    return
                obj[key] = data

                with open(file_path, "w") as f:
                    json.dump(obj, f, indent=2)
                self.respond(200, {"status": f"Replaced key '{key}' in {directory}/{file_name}", "path": file_path})

            elif action == "remove_key":
                if key is None:
                    self.send_error(400, "Missing 'key' parameter for remove_key")
                    return

                if not os.path.exists(file_path):
                    self.send_error(404, "File not found")
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
                    self.respond(200, {"status": f"Key '{key}' removed from {directory}/{file_name}", "path": file_path})
                else:
                    self.send_error(404, f"Key '{key}' not found")

            elif action == "delete":
                if os.path.exists(file_path):
                    os.remove(file_path)
                    self.respond(200, {"status": f"File {file_name} deleted from {directory}"})
                else:
                    self.send_error(404, "File not found")

            else:
                self.send_error(404, f"Unknown action: {action}")

        except FileNotFoundError:
            self.send_error(404, "File not found")
        except PermissionError:
            self.send_error(403, "Permission denied")
        except Exception as e:
            self.send_error(500, f"Server error: {str(e)}")

    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")  # Enable CORS
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode("utf-8"))

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def translate_path(self, path):
        """Serve files from current directory (./), not ./data/"""
        return super().translate_path(path)

# Run server
if __name__ == "__main__":
    print(f"Starting TTRPG JSON Server on port {PORT}")
    print(f"Directory mappings:")
    for name, path in DIRECTORIES.items():
        abs_path = os.path.abspath(path)
        print(f"  {name}: {abs_path}")
    
    try:
        with socketserver.TCPServer(("", PORT), JSONHandler) as httpd:
            print(f"\nServer running at http://localhost:{PORT}")
            print("Press Ctrl+C to stop the server")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped by user")
    except Exception as e:
        print(f"Server error: {e}")
