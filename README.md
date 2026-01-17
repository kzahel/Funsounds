# funsounds

**[Demo](https://kyle.graehl.org/Funsounds/)** 🚀

Generate sound effects from text prompts using [AudioCraft's AudioGen](https://github.com/facebookresearch/audiocraft/).

## Requirements

- Python 3.9
- NVIDIA GPU with at least 16GB memory
- ffmpeg

## Installation

```bash
uv venv --python 3.9 --seed
source .venv/bin/activate
BLIS_ARCH=generic pip install blis
pip install av==14.0.0
pip install audiocraft --no-deps
BLIS_ARCH=generic pip install einops flashy hydra-core hydra_colorlog julius num2words sentencepiece spacy xformers transformers demucs
pip install encodec librosa protobuf torchmetrics
```

## Usage

### Single sound

```bash
python makesound.py --prompt "dog barking" --output barking.wav
```

Options:
- `--prompt`, `-p` - Text description of the sound (required unless using --batch)
- `--output`, `-o` - Output file path (default: output.wav)
- `--duration`, `-d` - Duration in seconds (default: 5.0)
- `--model`, `-m` - Model to use (default: facebook/audiogen-medium)

### Batch mode

For generating many sounds efficiently (model loads once):

```bash
python makesound.py --batch sounds.json
```

JSON format:
```json
[
  {"prompt": "glass breaking", "filename": "glass.wav", "duration": 3},
  {"prompt": "door slamming shut", "filename": "door.wav", "duration": 2},
  {"prompt": "thunder rumbling in the distance", "filename": "thunder.wav"}
]
```

Fields:
- `prompt` - Text description (required)
- `filename` - Output file path (required)
- `duration` - Duration in seconds (optional, defaults to 5.0)

## Examples

```bash
# Short sound effect
python makesound.py -p "glass shattering" -o glass.wav -d 2

# Longer ambient sound
python makesound.py -p "rain falling on a metal roof" -o rain.wav -d 10

# Batch of sounds
python makesound.py --batch effects.json
```

## Notes

- First run downloads the ~1.5GB model weights (cached for future use)
- Output is always WAV format at 16kHz
- The model runs on GPU automatically when CUDA is available
