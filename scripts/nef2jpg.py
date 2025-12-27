#!/usr/bin/env python3
import json
import sys
import time
from pathlib import Path

try:
    import rawpy
    from PIL import Image
except ImportError:
    print("ERROR: Please install required packages: rawpy and pillow", file=sys.stderr)
    print("Run: pip install rawpy pillow", file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) < 3:
        print("Usage: nef2jpg.py input.NEF output.jpg", file=sys.stderr)
        sys.exit(2)
    nef_path = Path(sys.argv[1])
    jpg_path = Path(sys.argv[2])

    if not nef_path.exists():
        print(f"ERROR: File does not exist: {nef_path}", file=sys.stderr)
        sys.exit(3)

    # Read NEF and convert to RGB
    try:
        with rawpy.imread(str(nef_path)) as raw:
            rgb = raw.postprocess()
    except rawpy.LibRawError as e:
        print(f"ERROR: Failed to read NEF file: {e}", file=sys.stderr)
        print(f"File may be corrupted or not a valid NEF: {nef_path}", file=sys.stderr)
        sys.exit(4)
    except Exception as e:
        print(f"ERROR: Unexpected error reading NEF: {e}", file=sys.stderr)
        sys.exit(5)

    # Convert to JPEG
    try:
        img = Image.fromarray(rgb)
        img.save(jpg_path, format="JPEG", quality=98)
    except OSError as e:
        print(f"ERROR: Failed to save JPG file: {e}", file=sys.stderr)
        print(f"Check disk space and permissions for: {jpg_path}", file=sys.stderr)
        sys.exit(6)
    except Exception as e:
        print(f"ERROR: Unexpected error saving JPG: {e}", file=sys.stderr)
        sys.exit(7)

    # Write status file
    status_path = (
        Path.home()
        / "Library"
        / "Application Support"
        / "bildvisare"
        / "original_status.json"
    )
    status = {
        "timestamp": time.time(),
        "source_nef": str(nef_path),
        "exported_jpg": str(jpg_path),
        "exported": True,
    }

    try:
        status_path.parent.mkdir(parents=True, exist_ok=True)
        with open(status_path, "w") as f:
            json.dump(status, f, indent=2)
    except OSError as e:
        print(f"WARNING: Failed to write status file: {e}", file=sys.stderr)
        print(f"Conversion succeeded but status not saved to: {status_path}", file=sys.stderr)
        # Don't exit with error - conversion was successful
    except Exception as e:
        print(f"WARNING: Unexpected error writing status: {e}", file=sys.stderr)
        # Don't exit with error - conversion was successful


if __name__ == "__main__":
    main()
