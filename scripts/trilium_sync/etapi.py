"""Read-only client for Trilium's ETAPI. Standard library only.

Only GET requests are ever made, so this code cannot change your notes.
Every ETAPI path lives in this file; if Trilium's API differs from what is
written here, this is the only place to fix.

One connection is opened and reused for every request. That matters on a home
network: a name like `something.local` can resolve to several addresses, and
reconnecting for each request repeats the slow part every time.
"""
import http.client
import json
import urllib.parse


class EtapiError(Exception):
    """Raised for any failure talking to Trilium. Never contains the token."""


class Etapi:
    def __init__(self, base_url, token, transport=None, timeout=30):
        parts = urllib.parse.urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise EtapiError("The Trilium address must look like http://host:port or https://host")
        self._scheme = parts.scheme
        self._host = parts.netloc
        self._prefix = parts.path.rstrip("/") + "/etapi"
        self._token = token
        self._timeout = timeout
        self._transport = transport or self._http
        self._conn = None

    def _connect(self):
        cls = http.client.HTTPSConnection if self._scheme == "https" else http.client.HTTPConnection
        self._conn = cls(self._host, timeout=self._timeout)

    def _http(self, target):
        """GET `target`, reusing the open connection. Returns (status, body)."""
        for attempt in (1, 2):
            if self._conn is None:
                self._connect()
            try:
                self._conn.request("GET", target, headers={"Authorization": self._token})
                response = self._conn.getresponse()
                return response.status, response.read()
            except (http.client.HTTPException, OSError) as err:
                self._conn.close()
                self._conn = None               # stale connection: retry once fresh
                if attempt == 2:
                    raise EtapiError("Cannot reach Trilium: %s" % (err,)) from None

    def _get(self, path, params=None):
        target = self._prefix + path
        if params:
            target += "?" + urllib.parse.urlencode(params)
        status, body = self._transport(target)
        if status >= 400:
            raise EtapiError("Trilium answered HTTP %d for %s" % (status, path))
        return body

    def app_info(self):
        return json.loads(self._get("/app-info"))

    def search(self, query, ancestor_note_id):
        """Notes matching `query`, restricted to one subtree."""
        data = self._get("/notes", {"search": query, "ancestorNoteId": ancestor_note_id})
        return json.loads(data).get("results", [])

    def note(self, note_id):
        return json.loads(self._get("/notes/%s" % urllib.parse.quote(note_id)))

    def content_bytes(self, note_id):
        return self._get("/notes/%s/content" % urllib.parse.quote(note_id))

    def content(self, note_id):
        return self.content_bytes(note_id).decode("utf-8")

    def attachments(self, note_id):
        return json.loads(self._get("/notes/%s/attachments" % urllib.parse.quote(note_id)))

    def attachment_content(self, attachment_id):
        return self._get("/attachments/%s/content" % urllib.parse.quote(attachment_id))
