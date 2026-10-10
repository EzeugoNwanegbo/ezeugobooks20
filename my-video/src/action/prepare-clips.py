"""Prepare the three action clips from the captured website recording."""
import json
from pathlib import Path
import subprocess
import sys

folder = Path(sys.argv[1])
times = {item['name']: item['time'] for item in json.loads((folder / 'capture-report.json').read_text())['timeline']}
shots = [
    ('search', times['file-search'] - 1.3, times['answer'] + .15, 1, 8),
    ('setup', times['friends'] - .15, times['battle-setup'] - .05, 4, 3.5),
    ('quiz', times['battle-quiz'] - .1, times['battle-result'] - 2.8, 1.8, 4.5),
]
for name, start, end, slow, length in shots:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(folder / 'website-demo.webm'),
                    '-vf', f'trim=start={start}:end={end},setpts={slow}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration=3',
                    '-t', str(length), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
                    '-an', '-movflags', '+faststart', str(folder / f'{name}.mp4')], check=True)
