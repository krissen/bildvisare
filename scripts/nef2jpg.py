#!/usr/bin/env python3
"""
NEF to JPG converter for Bildvisare.

Converts Nikon RAW (NEF) files to JPEG format and writes status information
for the Bildvisare image viewer application.

Exit codes:
    0: Success
    1: Missing dependencies (rawpy or pillow)
    2: Invalid usage (missing arguments)
    3: Input file not found
    4: Failed to read NEF file (corrupted or invalid)
    5: Unexpected error reading NEF
    6: Failed to save JPG (disk full, permissions)
    7: Unexpected error saving JPG
    8: Invalid file extension (not .NEF/.nef)
    9: File size validation failed

Usage:
    nef2jpg.py [--verbose] input.NEF output.jpg
"""
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


# Configuration constants
MIN_FILE_SIZE = 1024 * 100  # 100 KB minimum
MAX_FILE_SIZE = 1024 * 1024 * 100  # 100 MB maximum
JPEG_QUALITY = 98
VALID_EXTENSIONS = {'.nef', '.NEF'}


def log_verbose(message, verbose=False):
    """Print message to stderr if verbose mode is enabled."""
    if verbose:
        print(f"[INFO] {message}", file=sys.stderr)


def validate_nef_file(file_path, verbose=False):
    """
    Validate that the input file is a valid NEF file.

    Args:
        file_path: Path object pointing to the NEF file
        verbose: Whether to print verbose messages

    Returns:
        True if valid, False otherwise

    Raises:
        SystemExit with appropriate code if validation fails
    """
    # Check file extension
    if file_path.suffix not in VALID_EXTENSIONS:
        print(f"ERROR: Invalid file extension: {file_path.suffix}", file=sys.stderr)
        print(f"Expected .NEF or .nef, got: {file_path}", file=sys.stderr)
        sys.exit(8)

    log_verbose(f"File extension valid: {file_path.suffix}", verbose)

    # Check file size
    file_size = file_path.stat().st_size
    log_verbose(f"File size: {file_size:,} bytes ({file_size / 1024 / 1024:.2f} MB)", verbose)

    if file_size < MIN_FILE_SIZE:
        print(f"ERROR: File too small ({file_size} bytes, minimum {MIN_FILE_SIZE})", file=sys.stderr)
        print(f"File may be corrupted: {file_path}", file=sys.stderr)
        sys.exit(9)

    if file_size > MAX_FILE_SIZE:
        print(f"ERROR: File too large ({file_size} bytes, maximum {MAX_FILE_SIZE})", file=sys.stderr)
        sys.exit(9)

    log_verbose("File size validation passed", verbose)
    return True


def validate_output_path(output_path, verbose=False):
    """
    Validate that the output path is safe to write to.

    Args:
        output_path: Path object for the output JPG file
        verbose: Whether to print verbose messages

    Raises:
        SystemExit if path is unsafe
    """
    # Basic safety check: don't allow paths outside /tmp or user directories
    resolved = output_path.resolve()
    home = Path.home()
    tmp = Path("/tmp")

    # Check if path is under /tmp or home directory
    try:
        is_safe = resolved.is_relative_to(tmp) or resolved.is_relative_to(home)
    except ValueError:
        is_safe = False

    if not is_safe:
        print(f"ERROR: Output path is not safe: {resolved}", file=sys.stderr)
        print(f"Path must be under /tmp or {home}", file=sys.stderr)
        sys.exit(9)

    log_verbose(f"Output path validation passed: {resolved}", verbose)


def main():
    """Main conversion function."""
    # Parse arguments
    verbose = False
    args = sys.argv[1:]

    if "--verbose" in args:
        verbose = True
        args.remove("--verbose")
        log_verbose("Verbose mode enabled", verbose)

    if len(args) < 2:
        print("Usage: nef2jpg.py [--verbose] input.NEF output.jpg", file=sys.stderr)
        sys.exit(2)

    nef_path = Path(args[0])
    jpg_path = Path(args[1])

    log_verbose(f"Input file: {nef_path}", verbose)
    log_verbose(f"Output file: {jpg_path}", verbose)

    # Validate input file exists
    if not nef_path.exists():
        print(f"ERROR: File does not exist: {nef_path}", file=sys.stderr)
        sys.exit(3)

    # Validate input file
    validate_nef_file(nef_path, verbose)

    # Validate output path
    validate_output_path(jpg_path, verbose)

    # Read NEF and convert to RGB
    start_time = time.time()
    log_verbose("Starting NEF conversion...", verbose)

    try:
        with rawpy.imread(str(nef_path)) as raw:
            rgb = raw.postprocess()
        log_verbose(f"NEF read successful, image size: {rgb.shape}", verbose)
    except rawpy.LibRawError as e:
        print(f"ERROR: Failed to read NEF file: {e}", file=sys.stderr)
        print(f"File may be corrupted or not a valid NEF: {nef_path}", file=sys.stderr)
        sys.exit(4)
    except Exception as e:
        print(f"ERROR: Unexpected error reading NEF: {e}", file=sys.stderr)
        sys.exit(5)

    # Convert to JPEG
    log_verbose(f"Converting to JPEG (quality={JPEG_QUALITY})...", verbose)

    try:
        img = Image.fromarray(rgb)
        img.save(jpg_path, format="JPEG", quality=JPEG_QUALITY)

        # Get output file size
        output_size = jpg_path.stat().st_size
        log_verbose(f"JPG saved: {output_size:,} bytes ({output_size / 1024 / 1024:.2f} MB)", verbose)
    except OSError as e:
        print(f"ERROR: Failed to save JPG file: {e}", file=sys.stderr)
        print(f"Check disk space and permissions for: {jpg_path}", file=sys.stderr)
        sys.exit(6)
    except Exception as e:
        print(f"ERROR: Unexpected error saving JPG: {e}", file=sys.stderr)
        sys.exit(7)

    elapsed = time.time() - start_time
    log_verbose(f"Conversion completed in {elapsed:.2f} seconds", verbose)

    # Write status file
    log_verbose("Writing status file...", verbose)

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
        log_verbose(f"Status file written: {status_path}", verbose)
    except OSError as e:
        print(f"WARNING: Failed to write status file: {e}", file=sys.stderr)
        print(f"Conversion succeeded but status not saved to: {status_path}", file=sys.stderr)
        # Don't exit with error - conversion was successful
    except Exception as e:
        print(f"WARNING: Unexpected error writing status: {e}", file=sys.stderr)
        # Don't exit with error - conversion was successful


if __name__ == "__main__":
    main()
