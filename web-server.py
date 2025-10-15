#!/usr/bin/env python3
"""Backward-compatible entrypoint that delegates to the modular server package."""

from __future__ import annotations

from server.app import main

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Universal TTRPG Sheets development server")
    parser.add_argument("--config", default="server.config.json", help="Path to server configuration file")
    args = parser.parse_args()
    main(args.config)
