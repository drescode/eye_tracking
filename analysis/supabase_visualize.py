#!/usr/bin/env python3
"""
Convenience entrypoint for the notebook-friendly analysis pipeline.

Usage:
  export DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
  python analysis/supabase_visualize.py
"""

from eye_tracking_pipeline import main


if __name__ == "__main__":
    main()
