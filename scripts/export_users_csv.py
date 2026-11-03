#!/usr/bin/env python3
"""
scripts/export_users_csv.py
CLI tool to generate and export TRIRIGA users (names, organisation, email addresses) to CSV.
Supports filtering by active vs inactive status, internal vs external vs OSLC account types,
organisation name, and search queries.

Usage:
    python scripts/export_users_csv.py
    python scripts/export_users_csv.py --status active --type internal --output active_internal_users.csv
    python scripts/export_users_csv.py --status all --type external --output all_external_users.csv
    python scripts/export_users_csv.py --org "Office of Public Works" --output opw_users.csv
"""

import sys
import os
import argparse
import asyncio
from datetime import datetime
from pathlib import Path

# Ensure workspace root is in python path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from backend.app.db.database import db_read_session, dict_from_row
from backend.app.services.operations_service import OperationsService


def get_target_server(server_id: int = None):
    with db_read_session() as conn:
        cur = conn.cursor()
        if server_id:
            cur.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError(f"Server ID {server_id} not found in database.")
            return dict_from_row(row)
        else:
            cur.execute("""
                SELECT * FROM servers 
                WHERE password IS NOT NULL AND password != ''
                ORDER BY 
                    CASE 
                        WHEN host = '169.50.115.221' THEN 1
                        WHEN name LIKE '%prod%' THEN 2
                        WHEN host LIKE '%169.50%' THEN 3
                        ELSE 4
                    END ASC, id DESC
                LIMIT 1
            """)
            row = cur.fetchone()
            if not row:
                raise ValueError("No reachable TRIRIGA server configured with credentials.")
            return dict_from_row(row)


async def main_async():
    parser = argparse.ArgumentParser(
        description="Export TRIRIGA users to CSV format with filtering by status and account type."
    )
    parser.add_argument(
        "--status",
        choices=["active", "inactive", "all"],
        default="active",
        help="Filter by user status: active (default), inactive, or all."
    )
    parser.add_argument(
        "--type",
        choices=["all", "internal", "external", "oslc"],
        default="all",
        help="Filter by account type: all (default), internal (employees), external (contractors/vendors), oslc (integrations)."
    )
    parser.add_argument(
        "--org",
        default=None,
        help="Filter by organisation name (e.g. 'Office of Public Works', 'PJ HEGARTY', etc.)."
    )
    parser.add_argument(
        "--search",
        default=None,
        help="Search query matching name, username, email, or organisation."
    )
    parser.add_argument(
        "--server",
        type=int,
        default=None,
        help="TRIRIGA Server ID to query (default: primary production node)."
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Destination path for CSV file (default: data/tririga_users_<timestamp>.csv)."
    )

    args = parser.parse_args()

    server = get_target_server(args.server)
    print("=" * 70)
    print("  TRIRIGA USER DIRECTORY & CSV EXPORTER")
    print(f"  Target Server: {server.get('name')} ({server.get('host')}:{server.get('port')})")
    print(f"  Filters: Status={args.status.upper()} | Type={args.type.upper()} | Org={args.org or 'ALL'} | Search={args.search or 'NONE'}")
    print("=" * 70)
    print("Fetching live users from TRIRIGA database...")

    result = await OperationsService.get_users_directory(
        server_info=server,
        status_filter=args.status,
        account_type_filter=args.type,
        org_filter=args.org,
        search_query=args.search
    )

    summary = result.get("summary", {})
    users = result.get("users", [])

    print(f"\n[+] Total Users in System: {summary.get('total', 0)}")
    print(f"    - Active Users:         {summary.get('active', 0)}")
    print(f"    - Inactive / Retired:   {summary.get('inactive', 0)}")
    print(f"    - Internal Employees:   {summary.get('internal', 0)}")
    print(f"    - External Contractors: {summary.get('external', 0)}")
    print(f"    - OSLC / API Integrations: {summary.get('oslc', 0)}")
    print(f"\n[+] Matching Users for Export: {len(users)}")

    if not users:
        print("[!] No users matched the specified criteria.")
        return

    csv_text = OperationsService.generate_users_csv(users)

    # Determine output file path
    if args.output:
        out_path = Path(args.output).resolve()
    else:
        out_dir = ROOT_DIR / "data"
        out_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        status_tag = f"_{args.status}" if args.status != "all" else ""
        type_tag = f"_{args.type}" if args.type != "all" else ""
        out_path = out_dir / f"tririga_users{status_tag}{type_tag}_{ts}.csv"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(csv_text, encoding="utf-8-sig")

    print(f"[+] Successfully exported {len(users)} users to:")
    print(f"    {out_path}")
    print("\nSample Preview (First 5 records):")
    print("-" * 70)
    for idx, u in enumerate(users[:5], 1):
        print(f"  {idx}. {u.get('user_name')} | {u.get('organization_clean')} | {u.get('email') or 'No Email'} | {u.get('account_type_label')} | {u.get('status')}")
    print("-" * 70)


def main():
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
