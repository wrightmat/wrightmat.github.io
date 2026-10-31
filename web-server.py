#!/usr/bin/env python3
"""Backward-compatible entrypoint that delegates to the modular server package."""

from __future__ import annotations

from server.app import main

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Universal TTRPG Sheets development server")
    parser.add_argument("--config", default="server.config.json", help="Path to server configuration file")
    parser.add_argument("--sync-defaults", action="store_true", help="Copy shipped files missing from data_dir, then exit")
    parser.add_argument(
        "--update",
        action="store_true",
        help="With --sync-defaults: show which already-seeded files can safely be brought up to date (dry run)",
    )
    parser.add_argument("--apply", action="store_true", help="With --sync-defaults --update: carry the plan out")
    parser.add_argument(
        "--accept-shipped",
        nargs="+",
        default=[],
        metavar="KIND_OR_PATH",
        help="With --sync-defaults --update: also replace edited or stale files of these kinds (e.g. template) or paths",
    )
    parser.add_argument("--create-admin", action="store_true", help="Create an admin account interactively, then exit")
    args = parser.parse_args()
    if (args.update or args.apply or args.accept_shipped) and not args.sync_defaults:
        parser.error("--update, --apply and --accept-shipped go with --sync-defaults")
    if (args.apply or args.accept_shipped) and not args.update:
        parser.error("--apply and --accept-shipped go with --update")
    if args.sync_defaults:
        from server.app import sync_default_files

        sync_default_files(args.config, update=args.update, apply=args.apply, accept=args.accept_shipped)
    elif args.create_admin:
        from server.app import create_admin

        create_admin(args.config)
    else:
        main(args.config)
