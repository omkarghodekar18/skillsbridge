"""
Setup NLP dependencies required by the resume parser.

Run this once after setting up your virtual environment:
    venv/bin/python setup_dependencies.py   (Linux/macOS)
    venv\\Scripts\\python setup_dependencies.py  (Windows)

Or activate the venv first and then run:
    python setup_dependencies.py
"""

import subprocess
import sys
import os

# ── helpers ──────────────────────────────────────────────────────────────────

def python_exec():
    """Return the Python executable for this environment."""
    return sys.executable


def run(cmd, check=True):
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode != 0:
        if result.stderr.strip():
            print(result.stderr.strip())
        if check:
            sys.exit(f"\n✗ Command failed: {' '.join(cmd)}")
    return result


# ── spaCy model ───────────────────────────────────────────────────────────────

SPACY_MODEL = "en_core_web_lg"

def ensure_spacy_model():
    print(f"\n[1/1] Checking spaCy model '{SPACY_MODEL}'...")
    try:
        import spacy  # noqa: PLC0415
        spacy.load(SPACY_MODEL)
        print(f"  ✓ '{SPACY_MODEL}' is already installed.")
    except ModuleNotFoundError:
        sys.exit(
            "✗ spaCy is not installed in this Python environment.\n"
            f"  Run:  {python_exec()} -m pip install spacy~=3.8.11\n"
            "  Then re-run this script."
        )
    except OSError:
        print(f"  ↓ Downloading '{SPACY_MODEL}' — this may take a few minutes (~400 MB)…")
        run([python_exec(), "-m", "spacy", "download", SPACY_MODEL])
        # Verify it loads after download
        try:
            import spacy  # noqa: PLC0415
            spacy.load(SPACY_MODEL)
            print(f"  ✓ '{SPACY_MODEL}' installed and verified successfully.")
        except OSError as exc:
            sys.exit(f"✗ Model download completed but still cannot load: {exc}")


# ── NLTK data (punkt tokeniser used by some parsers) ─────────────────────────

def ensure_nltk_data():
    print("\n[Optional] Checking NLTK tokeniser data…")
    try:
        import nltk  # noqa: PLC0415
        try:
            nltk.data.find("tokenizers/punkt")
            print("  ✓ NLTK punkt already present.")
        except LookupError:
            print("  ↓ Downloading NLTK punkt…")
            nltk.download("punkt", quiet=True)
            print("  ✓ NLTK punkt downloaded.")
    except ModuleNotFoundError:
        print("  – NLTK not installed, skipping.")


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Resume-parser dependency setup")
    print(f"  Python: {python_exec()}")
    print("=" * 60)

    ensure_spacy_model()
    ensure_nltk_data()

    print("\n" + "=" * 60)
    print("  ✓ All NLP dependencies are ready. You can now run:")
    print(f"    {python_exec()} app.py")
    print("=" * 60)


if __name__ == "__main__":
    main()