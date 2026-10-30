#!/usr/bin/env python3
"""Backward-compatible entrypoint that delegates to the modular server package."""

from __future__ import annotations

from server.app import main

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Universal TTRPG Sheets development server")
    parser.add_argument("--config", default="server.config.json", help="Path to server configuration file")
    parser.add_argument("--sync-defaults", action="store_true", help="Copy shipped files missing from data_dir, then exit")
    parser.add_argument("--create-admin", action="store_true", help="Create an admin account interactively, then exit")
    args = parser.parse_args()
    if args.sync_defaults:
        from server.app import sync_default_files

        sync_default_files(args.config)
    elif args.create_admin:
        from server.app import create_admin

        create_admin(args.config)
    else:
        main(args.config)
