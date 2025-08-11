import http.server
import socketserver
import urllib.parse
import os
import json
import re
import sqlite3
import time
import contextlib
import uuid
import platform
from pathlib import Path
from datetime import datetime, timedelta

# Platform-specific imports
if platform.system() != 'Windows':
    import fcntl
else:
    # Windows file locking alternative
    import msvcrt

PORT = 8000

# Define directory mappings
DIRECTORIES = {
    "characters": "sheet/data/characters",
    "templates": "sheet/data/templates", 
    "schemas": "sheet/data/schemas",
    "codex_data": "codex/data",
    "codex_templates": "codex/templates",
}

# Ensure all directories exist
for dir_path in DIRECTORIES.values():
    os.makedirs(dir_path, exist_ok=True)

class Database:
    def __init__(self):
        self.db_path = 'sheet/data/database.sqlite'
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.init_tables()
    
    def init_tables(self):
        # User management
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email VARCHAR(255) UNIQUE NOT NULL,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                tier VARCHAR(20) DEFAULT 'free',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                is_active BOOLEAN DEFAULT 1
            )
        ''')
        
        # Session management
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                session_token VARCHAR(255) UNIQUE NOT NULL,
                ip_address VARCHAR(45),
                user_agent TEXT,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')
        
        # Content metadata tables
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS characters (
                id VARCHAR(50) PRIMARY KEY,
                owner_id INTEGER,
                name VARCHAR(255),
                system VARCHAR(100),
                template VARCHAR(100),
                filename VARCHAR(255) NOT NULL,
                is_public BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
            )
        ''')
        
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS templates (
                id VARCHAR(50) PRIMARY KEY,
                owner_id INTEGER,
                title VARCHAR(255),
                schema VARCHAR(100),
                filename VARCHAR(255) NOT NULL,
                is_public BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
            )
        ''')
        
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS schemas (
                id VARCHAR(50) PRIMARY KEY,
                owner_id INTEGER,
                title VARCHAR(255),
                "index" VARCHAR(100),
                filename VARCHAR(255) NOT NULL,
                is_public BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
            )
        ''')
        
        # Universal sharing table
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS shares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type VARCHAR(20) NOT NULL,
                content_id VARCHAR(50) NOT NULL,
                shared_with_user_id INTEGER NOT NULL,
                permissions VARCHAR(20) DEFAULT 'view',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(content_type, content_id, shared_with_user_id)
            )
        ''')
        
        # Create indexes
        self.conn.execute('CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id)')
        self.conn.execute('CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates(owner_id)')
        self.conn.execute('CREATE INDEX IF NOT EXISTS idx_schemas_owner ON schemas(owner_id)')
        self.conn.execute('CREATE INDEX IF NOT EXISTS idx_shares_content ON shares(content_type, content_id)')
        self.conn.execute('CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(shared_with_user_id)')
        self.conn.execute('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)')
        self.conn.execute('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)')
        
        self.conn.commit()

    def save_content_metadata(self, content_type, data, user_id=None):
        """Save metadata for any content type"""
        try:
            now = datetime.now()
        
            if content_type == 'characters':
                character_name = 'Unnamed'
                if 'data' in data and isinstance(data['data'], dict):
                    character_name = data['data'].get('name', 'Unnamed')
                elif 'name' in data:
                    character_name = data.get('name', 'Unnamed')

                existing = None
                try:
                    cursor = self.conn.execute('SELECT * FROM characters WHERE id = ?', (data['id'],))
                    existing = cursor.fetchone()
                except:
                    pass
        
                system = existing['system'] if existing else None
                template = existing['template'] if existing else None

                self.conn.execute('''
                    INSERT OR REPLACE INTO characters 
                    (id, owner_id, name, system, template, filename, modified_at, last_accessed_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    data['id'], user_id, character_name, system, template, f"{data['id']}.json", now, now
                ))
            elif content_type == 'templates':
                self.conn.execute('''
                    INSERT OR REPLACE INTO templates 
                    (id, owner_id, title, schema, filename, modified_at) 
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    data['id'], user_id, data.get('title', 'Unnamed'), data.get('schema'), f"{data['id']}.json", now
                ))
            elif content_type == 'schemas':
                self.conn.execute('''
                    INSERT OR REPLACE INTO schemas 
                    (id, owner_id, title, "index", filename, modified_at) 
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    data['id'], user_id, data.get('title', 'Unnamed'), data.get('index'), f"{data['id']}.json", now
                ))

            self.conn.commit()
            print(f"[DEBUG] Database commit successful")

        except Exception as e:
            print(f"[ERROR] Database error in save_content_metadata: {e}")
            import traceback
            traceback.print_exc()
            raise

    def get_all_content(self, content_type):
        """Get all content for unregistered users"""
        if content_type not in ['characters', 'templates', 'schemas']:
            return []
        
        cursor = self.conn.execute(f'''
            SELECT * FROM {content_type} 
            ORDER BY modified_at DESC
        ''')
        return [dict(row) for row in cursor.fetchall()]

    def get_user_content(self, content_type, user_id):
        """Get content list for user (owned + shared + public)"""
        if content_type not in ['characters', 'templates', 'schemas']:
            return []
            
        # Get owned content
        cursor = self.conn.execute(f'''
            SELECT * FROM {content_type} WHERE owner_id = ? 
            ORDER BY modified_at DESC
        ''', (user_id,))
        owned = [dict(row) for row in cursor.fetchall()]
        
        # Get shared content
        cursor = self.conn.execute(f'''
            SELECT c.*, s.permissions FROM {content_type} c
            JOIN shares s ON s.content_id = c.id AND s.content_type = ?
            WHERE s.shared_with_user_id = ?
            ORDER BY c.modified_at DESC
        ''', (content_type[:-1], user_id))  # Remove 's' from table name
        shared = [dict(row) for row in cursor.fetchall()]
        
        # Get public content (not owned by user)
        cursor = self.conn.execute(f'''
            SELECT * FROM {content_type} WHERE is_public = 1 AND owner_id != ?
            ORDER BY modified_at DESC
        ''', (user_id,))
        public = [dict(row) for row in cursor.fetchall()]
        
        return {
            'owned': owned,
            'shared': shared,
            'public': public
        }
    
    def get_unregistered_content_list(self, content_type):
        """Get file list for unregistered users"""
        dir_path = DIRECTORIES[content_type]
        try:
            files = [f for f in os.listdir(dir_path) if f.endswith('.json')]
            return [f.replace('.json', '') for f in files]
        except:
            return []
    
    def validate_session(self, session_token):
        """Validate session token and return user info"""
        if not session_token:
            return None
            
        cursor = self.conn.execute('''
            SELECT u.*, s.session_token FROM users u
            JOIN sessions s ON s.user_id = u.id
            WHERE s.session_token = ? AND s.expires_at > ? AND s.is_active = 1
        ''', (session_token, datetime.now()))
        
        user = cursor.fetchone()
        if user:
            # Update last accessed
            self.conn.execute('''
                UPDATE sessions SET last_accessed_at = ? WHERE session_token = ?
            ''', (datetime.now(), session_token))
            self.conn.commit()
            return dict(user)
        return None

@contextlib.contextmanager
def file_lock(file_path, mode='r+', max_retries=3, retry_delay=1.0):
    """File locking only on Unix systems"""
    if platform.system() != 'Windows':
        # Unix file locking
        attempt = 0
        while attempt < max_retries:
            try:
                file_obj = open(file_path, mode)
                try:
                    fcntl.flock(file_obj.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    yield file_obj
                    return
                except BlockingIOError:
                    file_obj.close()
                    attempt += 1
                    if attempt < max_retries:
                        time.sleep(retry_delay)
                    else:
                        raise TimeoutError(f"Could not acquire lock on {file_path} after {max_retries} attempts")
                finally:
                    if not file_obj.closed:
                        fcntl.flock(file_obj.fileno(), fcntl.LOCK_UN)
                        file_obj.close()
            except FileNotFoundError:
                if 'w' in mode:
                    with open(file_path, 'w') as f:
                        pass
                    continue
                else:
                    raise
    else:
        # Windows - no locking, just open file
        try:
            if mode == 'r+' and not os.path.exists(file_path):
                with open(file_path, 'w') as f:
                    json.dump({}, f)
            
            with open(file_path, mode) as file_obj:
                yield file_obj
        except FileNotFoundError:
            if 'w' in mode:
                with open(file_path, 'w') as f:
                    pass
                with open(file_path, mode) as file_obj:
                    yield file_obj
            else:
                raise

class JSONHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.db = Database()
        super().__init__(*args, **kwargs)
    
    def get_current_user(self):
        """Get current user from session token"""
        # Look for session token in Authorization header or cookie
        auth_header = self.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            session_token = auth_header[7:]
            return self.db.validate_session(session_token)
        return None
    
    def do_GET(self):
        if self.path.startswith("/list/"):
            directory = self.path.split("/list/")[1]
            user = self.get_current_user()

            if directory in DIRECTORIES:
                try:
                    if directory in ['characters', 'templates', 'schemas']:
                        if user:
                            content = self.db.get_user_content(directory, user['id'])
                            self.respond(200, content)
                        else:
                            content = self.db.get_all_content(directory)
                            self.respond(200, content)
                    else:
                        # Non-metadata directories use file system
                        file_list = self.db.get_unregistered_content_list(directory)
                        self.respond(200, file_list)
                except Exception as e:
                    self.send_error(500, f"Error listing directory: {str(e)}")
            else:
                self.send_error(400, f"Invalid directory: {directory}")
        elif self.path == "/templates/list":
            templates = []
            template_dir = DIRECTORIES.get("codex_templates", ".")
            try:
                for filename in os.listdir(template_dir):
                    if filename.endswith(".html") or filename.endswith(".htm"):
                        filepath = os.path.join(template_dir, filename)
                        with file_lock(filepath, 'r', encoding='utf-8') as f:
                            lines = [next(f, '') for _ in range(20)]
                            metadata = self.extract_metadata(lines)

                        template_entry = {"filename": os.path.splitext(filename)[0]}
                        template_entry.update(metadata)
                        templates.append(template_entry)

                self.respond(200, templates)
            except Exception as e:
                self.send_error(500, f"Server error: {str(e)}")
        elif self.path == "/debug/database":
            try:
                tables = ['users', 'sessions', 'characters', 'templates', 'schemas', 'shares']
                result = {}
        
                for table in tables:
                    cursor = self.db.conn.execute(f'SELECT * FROM {table}')
                    result[table] = [dict(row) for row in cursor.fetchall()]
        
                self.respond(200, result)
            except Exception as e:
                self.send_error(500, f"Database error: {str(e)}")
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
        directory = query.get("dir", ["codex_data"])[0]

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
        user = self.get_current_user()

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        try:
            data = json.loads(body) if body else None
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON body")
            return

        try:
            if action == "write":
                if directory in ["templates", "characters", "schemas"]:
                    try:
                        with file_lock(file_path, 'w') as f:
                            json.dump(data, f, indent=2)
                        
                        # Save metadata to database
                        self.db.save_content_metadata(directory, data, user['id'] if user else None)

                        self.respond(200, {"status": f"File {file_name} saved to {directory}", "path": file_path})
                    except PermissionError as e:
                        self.send_error(403, f"Permission denied: {str(e)} - Check directory permissions for {base_dir}")
                    except TimeoutError as e:
                        self.send_error(503, f"File is busy, please try again: {str(e)}")
                    except Exception as e:
                        self.send_error(500, f"Unexpected error: {str(e)} - Path: {file_path}")
                else:
                    # Original append/merge behavior for data directory
                    try:
                        existing = {}
                        if os.path.exists(file_path):
                            with file_lock(file_path, 'r') as f:
                                existing = json.load(f)

                        if isinstance(existing, list) and isinstance(data, list):
                            existing.extend(data)
                        elif isinstance(existing, dict) and isinstance(data, dict):
                            existing.update(data)
                        else:
                            existing = data

                        with file_lock(file_path, 'w') as f:
                            json.dump(existing, f, indent=2)
                        self.respond(200, {"status": "File created or updated", "path": file_path})
                    except TimeoutError as e:
                        self.send_error(503, f"File is busy, please try again: {str(e)}")

            elif action == "replace":
                if key is None:
                    self.send_error(400, "Missing 'key' parameter for replace")
                    return

                try:
                    with file_lock(file_path, 'r+') as f:
                        obj = json.load(f)
                        if not isinstance(obj, dict):
                            self.send_error(400, "Replace only supports JSON objects")
                            return
                        obj[key] = data
                        f.seek(0)
                        f.truncate()
                        json.dump(obj, f, indent=2)
                    self.respond(200, {"status": f"Replaced key '{key}' in {directory}/{file_name}", "path": file_path})
                except (FileNotFoundError, TimeoutError) as e:
                    self.send_error(404 if isinstance(e, FileNotFoundError) else 503, str(e))

            elif action == "remove_key":
                if key is None:
                    self.send_error(400, "Missing 'key' parameter for remove_key")
                    return

                try:
                    with file_lock(file_path, 'r+') as f:
                        obj = json.load(f)
                        if not isinstance(obj, dict):
                            self.send_error(400, "Cannot remove key from non-dict JSON")
                            return
                        if key in obj:
                            del obj[key]
                            f.seek(0)
                            f.truncate()
                            json.dump(obj, f, indent=2)
                            self.respond(200, {"status": f"Key '{key}' removed from {directory}/{file_name}", "path": file_path})
                        else:
                            self.send_error(404, f"Key '{key}' not found")
                except (FileNotFoundError, TimeoutError) as e:
                    self.send_error(404 if isinstance(e, FileNotFoundError) else 503, str(e))

            elif action == "delete":
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                        # TODO: Remove from database metadata
                        self.respond(200, {"status": f"File {file_name} deleted from {directory}"})
                    else:
                        self.send_error(404, "File not found")
                except Exception as e:
                    self.send_error(500, f"Error deleting file: {str(e)}")

            else:
                self.send_error(404, f"Unknown action: {action}")

        except PermissionError:
            self.send_error(403, "Permission denied")
        except Exception as e:
            self.send_error(500, f"Server error: {str(e)}")

    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode("utf-8"))

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def translate_path(self, path):
        """Serve files from current directory (./), not ./data/"""
        return super().translate_path(path)

# Run server
if __name__ == "__main__":
    print(f"Starting Server on port {PORT}")
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