"""
main.py
---------

This script serves as the entry point for a simple automation pipeline that
records a timestamped message in a Notion database and sends a notification
via Telegram.  It is designed to run on a Windows machine under the task
scheduler every 15 minutes but can be executed manually for testing.

Configuration values such as API tokens and identifiers are loaded from
environment variables.  See `.env.example` for the expected variables.
"""

import os
import sys
import datetime as _dt
from typing import Optional

import requests

try:
    from dotenv import load_dotenv
except ImportError:
    # If python‑dotenv isn't installed the script will still run as long as
    # environment variables are defined externally.
    load_dotenv = None  # type: ignore



def _load_environment() -> None:
    """Load environment variables from a `.env` file if present."""
    if load_dotenv is not None:
        # The current working directory is where the script resides; try to
        # load a `.env` file in this directory or its parent.
        for candidate in (os.getcwd(), os.path.dirname(os.getcwd())):
            env_path = os.path.join(candidate, ".env")
            if os.path.exists(env_path):
                load_dotenv(dotenv_path=env_path, override=False)
                break


def _send_telegram_message(token: str, chat_id: str, text: str) -> None:
    """Send a plain‑text message to a Telegram chat.

    Args:
        token: Bot token obtained from BotFather.
        chat_id: Unique identifier for the target chat or channel.
        text: Message content.
    """
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
    }
    try:
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"[WARNING] Telegram notification failed: {exc}")



def _create_notion_record(
    notion_token: str,
    database_id: str,
    title: str,
    timestamp: str,
) -> Optional[str]:
    """Create a new page in a Notion database.

    Returns the URL of the created page on success, or None on failure.
    """
    url = "https://api.notion.com/v1/pages"
    headers = {
        "Authorization": f"Bearer {notion_token}",
        # The Notion API version header is required.
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }
    payload = {
        "parent": {"database_id": database_id},
        "properties": {
            "Name": {
                "title": [
                    {
                        "text": {
                            "content": title,
                        }
                    }
                ]
            },
            "Timestamp": {
                "rich_text": [
                    {
                        "text": {
                            "content": timestamp,
                        }
                    }
                ]
            },
        },
    }
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        response.raise_for_status()
        data = response.json()
        return data.get("url")
    except requests.RequestException as exc:
        print(f"[WARNING] Notion API request failed: {exc}")
        return None



def main() -> None:
    """Entry point for the automation.

    Loads configuration from the environment, creates a record in Notion, and
    sends a Telegram notification summarizing the action.  If either action
    fails the script logs a warning but continues so that the Windows Task
    Scheduler can mark the run as successful.
    """
    _load_environment()
    notion_token = os.getenv("NOTION_TOKEN")
    notion_db = os.getenv("NOTION_DATABASE_ID")
    telegram_token = os.getenv("TELEGRAM_TOKEN")
    telegram_chat = os.getenv("TELEGRAM_CHAT_ID")
    page_title = os.getenv("NOTION_PAGE_TITLE", "Automated Log Entry")

    missing = [k for k, v in {
        "NOTION_TOKEN": notion_token,
        "NOTION_DATABASE_ID": notion_db,
        "TELEGRAM_TOKEN": telegram_token,
        "TELEGRAM_CHAT_ID": telegram_chat,
    }.items() if not v]
    if missing:
        sys.stderr.write(
            "ERROR: Missing required environment variables: " + ", ".join(missing) + "\n"
        )
        sys.exit(1)

    now = _dt.datetime.now().astimezone()
    timestamp_str = now.isoformat()

    # Create a record in Notion.
    page_url = _create_notion_record(
        notion_token=notion_token,
        database_id=notion_db,
        title=page_title,
        timestamp=timestamp_str,
    )
    if page_url:
        notion_message = f"✅ Notion record created: {page_url}"
    else:
        notion_message = "⚠️ Failed to create Notion record."

    # Send the Telegram message summarizing the result.
    message_lines = [
        f"<b>Automation Run</b>",
        f"Time: {timestamp_str}",
        notion_message,
    ]
    _send_telegram_message(telegram_token, telegram_chat, "\n".join(message_lines))



if __name__ == "__main__":
    main()
