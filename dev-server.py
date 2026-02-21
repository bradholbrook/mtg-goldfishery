#!/usr/bin/env python3
"""
Dev server for mtg-goldfishery.
Identical to python3 -m http.server but adds Cache-Control: no-store so
ES module changes are always picked up without a hard reload.
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Suppress noisy request logs; only show errors
        if int(args[1]) >= 400:
            super().log_message(fmt, *args)

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f'Serving at http://localhost:{PORT}  (Cache-Control: no-store — Ctrl+C to stop)')
http.server.HTTPServer(('', PORT), NoCacheHandler).serve_forever()
