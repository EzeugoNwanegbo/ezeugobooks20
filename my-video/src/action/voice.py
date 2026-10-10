"""Create an offline generated narrator and fit each line to its scene.

Requires sherpa-onnx and soundfile. Pass the extracted sherpa-onnx
vits-piper-en_US-ljspeech-medium model directory and the output directory.
"""
import json
from pathlib import Path
import subprocess
import sys
import wave
import sherpa_onnx
import soundfile as sf

model = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
lines = [
    (0.3, 3.5, "Three hundred pages. One question. Brain still buffering?"),
    (4.3, 7.3, "Choose your textbook. Ask your question. Let pinpoint search find the relevant parts."),
    (12.3, 5.2, "Get an explanation grounded in your files. See where it came from."),
    (18.3, 7.2, "Ready to test yourself? Pick a friend. Set up Battle Royale and send the challenge."),
    (26.3, 6.2, "Same questions. Play at your own pace, then compare your scores."),
    (33.2, 6.3, "For law and medicine. Find it. Understand it. Prove it. G D one dot online."),
]
config = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(
            model=str(model / "en_US-ljspeech-medium.onnx"),
            tokens=str(model / "tokens.txt"),
            data_dir=str(model / "espeak-ng-data"),
        ),
        num_threads=2,
        provider="cpu",
    )
)
tts = sherpa_onnx.OfflineTts(config)
clips = []
for index, (start, budget, text) in enumerate(lines):
    audio = tts.generate(text, sid=0, speed=1.0)
    raw = output / f"voice-{index}-raw.wav"
    sf.write(raw, audio.samples, audio.sample_rate)
    duration = len(audio.samples) / audio.sample_rate
    tempo = max(1.0, duration / budget)
    path = output / f"voice-{index}.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
                    "-af", f"atempo={tempo},loudnorm=I=-16:TP=-2:LRA=7",
                    "-ar", "44100", "-ac", "2", str(path)], check=True)
    clips.append({"start": start, "budget": budget, "text": text,
                  "raw_seconds": duration, "tempo": tempo})
    print(f"line {index}: {duration:.2f}s, tempo {tempo:.2f}", flush=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                "anullsrc=r=44100:cl=stereo", "-t", "40", str(output / "silence.wav")], check=True)
with wave.open(str(output / "silence.wav"), "rb") as silence:
    import numpy as np
    track = np.frombuffer(silence.readframes(silence.getnframes()), dtype="<i2").copy().reshape(-1, 2)
    for index, (start, budget, _) in enumerate(lines):
        samples, _ = sf.read(output / f"voice-{index}.wav", dtype="int16", always_2d=True)
        pos = round(start * 44100)
        track[pos:pos + len(samples)] = samples
    sf.write(output / "narration.wav", track, 44100, subtype="PCM_16")
(output / "narration.json").write_text(json.dumps(clips, indent=2))
