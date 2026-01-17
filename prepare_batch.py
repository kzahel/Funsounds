#!/usr/bin/env python3
"""Convert toddler_sounds.json to batch format for makesound.py."""

import json
from pathlib import Path


def main():
    source = Path(__file__).parent / "toddler_sounds.json"
    output = Path(__file__).parent / "batch.json"

    with open(source) as f:
        data = json.load(f)

    batch = []
    for sound in data["sounds"]:
        batch.append({
            "prompt": sound["prompt"],
            "filename": sound["filename"],
            "duration": sound["duration"]
        })

    with open(output, "w") as f:
        json.dump(batch, f, indent=2)

    print(f"Created {output} with {len(batch)} sounds")
    print(f"\nRun: python makesound.py --batch batch.json")


if __name__ == "__main__":
    main()
