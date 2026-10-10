"""Offline preview voice, original music and timed motion accents."""
from pathlib import Path
import json
import subprocess
import sys
import numpy as np
import sherpa_onnx
import soundfile as sf

model, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
rate, seconds = 44100, 24
lines = [
    (0.25, 3.5, "Big books. Bigger questions. Meet G and D."),
    (4.15, 6.5, "Ask your books. Get clear explanations, grounded in the text, with sources you can check."),
    (11.15, 8.5, "Think you've mastered it? Battle Royale. Challenge a friend. Same questions. Your own pace. Compare scores. Rematch?"),
    (20.4, 3.3, "G D one dot online. Learn it. Prove it."),
]
tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(
        model=str(model/'en_US-ljspeech-medium.onnx'), tokens=str(model/'tokens.txt'),
        data_dir=str(model/'espeak-ng-data')), num_threads=2, provider='cpu')))
voice = np.zeros((rate*seconds, 2), dtype=np.float32)
report = []
for i, (start,budget,text) in enumerate(lines):
    audio=tts.generate(text,sid=0,speed=1.0)
    duration=len(audio.samples)/audio.sample_rate
    tempo=max(1,duration/budget)
    raw, fitted=output/f'raw-{i}.wav', output/f'line-{i}.wav'
    sf.write(raw,audio.samples,audio.sample_rate)
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(raw),'-af',f'atempo={tempo},loudnorm=I=-16:TP=-2:LRA=7','-ar',str(rate),'-ac','2',str(fitted)],check=True)
    samples,_=sf.read(fitted,always_2d=True)
    pos=round(start*rate)
    voice[pos:pos+len(samples)]=samples
    report.append(dict(start=start,budget=budget,text=text,raw_seconds=duration,tempo=tempo))
    print(f'Voice {i}: {duration:.2f}s, tempo {tempo:.2f}',flush=True)
sf.write(output/'voice.wav',voice,rate)
(output/'script.json').write_text(json.dumps(report,indent=2))
subprocess.run(['python3',str(Path(__file__).parent.parent/'intro/music.py'),str(output/'music.wav'),'24'],check=True)
sfx=np.zeros(rate*seconds)
rng=np.random.default_rng(22)
for start,duration in [(0.15,.45),(3.7,.7),(6.7,.5),(10.7,.6),(17.1,.5),(20.1,.5)]:
    t=np.arange(round(rate*duration))/rate
    envelope=np.sin(np.pi*t/duration)**2
    noise=rng.normal(0,1,len(t))
    smooth=np.convolve(noise,np.ones(12)/12,mode='same')
    sweep=np.sin(2*np.pi*(180*t+900*t*t))
    sound=(smooth*.25+sweep*.06)*envelope
    pos=round(start*rate);sfx[pos:pos+len(t)]+=sound
for start in [4,7.3,11,15.5,18.2,21.1]:
    t=np.arange(round(rate*.28))/rate
    sound=(np.sin(2*np.pi*660*t)+.5*np.sin(2*np.pi*990*t))*.06*np.exp(-t*16)
    pos=round(start*rate);sfx[pos:pos+len(t)]+=sound
sf.write(output/'effects.wav',np.column_stack([sfx,sfx]),rate)
