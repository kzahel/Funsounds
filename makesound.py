#!/usr/bin/env python3
"""Generate sound effects from text prompts using AudioGen."""

import argparse
import json
from pathlib import Path


def generate_single(model, audio_write, prompt, output, duration):
    """Generate a single sound effect."""
    model.set_generation_params(duration=duration)
    wav = model.generate([prompt])

    output_path = Path(output)
    stem = str(output_path.with_suffix(""))

    audio_write(
        stem,
        wav[0].cpu(),
        model.sample_rate,
        strategy="loudness",
        loudness_compressor=True
    )

    return output_path.with_suffix(".wav")


def main():
    parser = argparse.ArgumentParser(
        description="Generate sound effects from text prompts using AudioGen"
    )
    parser.add_argument(
        "--prompt", "-p",
        type=str,
        help="Text description of the sound effect to generate"
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="output.wav",
        help="Output file path (default: output.wav)"
    )
    parser.add_argument(
        "--duration", "-d",
        type=float,
        default=5.0,
        help="Duration of generated audio in seconds (default: 5.0)"
    )
    parser.add_argument(
        "--model", "-m",
        type=str,
        default="facebook/audiogen-medium",
        help="Model to use (default: facebook/audiogen-medium)"
    )
    parser.add_argument(
        "--batch", "-b",
        type=str,
        help="JSON file with batch of sounds: [{\"prompt\": ..., \"filename\": ..., \"duration\": ...}, ...]"
    )
    args = parser.parse_args()

    if not args.batch and not args.prompt:
        parser.error("Either --prompt or --batch is required")

    # Import here to avoid slow startup when just showing help
    print(f"Loading model {args.model}...")
    from audiocraft.models import AudioGen
    from audiocraft.data.audio import audio_write

    model = AudioGen.get_pretrained(args.model)

    if args.batch:
        with open(args.batch) as f:
            batch = json.load(f)

        print(f"Generating {len(batch)} sounds...")
        for i, item in enumerate(batch, 1):
            prompt = item["prompt"]
            filename = item["filename"]
            duration = item.get("duration", args.duration)

            print(f"[{i}/{len(batch)}] {prompt}")
            final_path = generate_single(model, audio_write, prompt, filename, duration)
            print(f"  -> {final_path}")

        print(f"Done! Generated {len(batch)} sounds.")
    else:
        print(f"Generating sound: {args.prompt}")
        final_path = generate_single(model, audio_write, args.prompt, args.output, args.duration)
        print(f"Saved to: {final_path}")


if __name__ == "__main__":
    main()
