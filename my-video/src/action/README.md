# G&D in action

40-second vertical promo, 1080 × 1920, 30 fps. It introduces file search,
source-grounded explanations and head-to-head friend quizzes, for law and
medicine students, with a calm generated narrator and a playful opening.

## What the footage shows

The recording in `public/action/website-demo.webm` comes from the actual local
website checkout. Playwright interacted with the Library, chat file picker,
chat composer, Battle Royale setup, quiz, results and friend battle record.
The files, search results, AI response, players and scores are **sample data**.
All backend traffic was intercepted, including writes and paid AI requests;
no real users were contacted and no credits were spent. This is a product
demonstration, not a production backend or performance test. The video carries
that disclosure on screen.

`capture-report.json` records the screenshot times, intercepted operations and
browser errors. Film editing slows down the brief quiz interaction and holds
the answer/result screenshots to improve readability. Friend battles are
asynchronous head-to-head challenges; the film does not advertise a live
multi-player tournament or an in-match changing leaderboard.

## Render

From `my-video`, after `npm ci`, with FFmpeg installed:

```sh
python3 src/action/prepare-clips.py public/action
npx remotion render src/action/index.tsx GandDInAction /tmp/gd-action-silent.mp4 --browser-executable=/usr/bin/chromium --crf=20
ffmpeg -i /tmp/gd-action-silent.mp4 -i public/action/narration.m4a -i public/action/music.m4a -filter_complex '[1:a]asplit=2[v1][v2];[2:a]volume=0.85,afade=t=in:d=1.5,afade=t=out:st=37:d=3[bed];[bed][v1]sidechaincompress=threshold=0.025:ratio=5:attack=20:release=350[ducked];[v2][ducked]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.93[a]' -map 0:v:0 -map '[a]' -vf scale=in_range=pc:out_range=tv -c:v libx264 -preset fast -crf 21 -pix_fmt yuv420p -color_range tv -c:a aac -b:a 160k -t 40 -movflags +faststart /tmp/gandd-in-action.mp4
```

The narrator is generated offline with sherpa-onnx's distribution of Piper
`vits-piper-en_US-ljspeech-medium`. Its model card identifies the LJ Speech
training dataset as public domain. Model source:
https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models

To regenerate narration, install `sherpa-onnx` and `soundfile`, extract that
model, then run `python3 src/action/voice.py MODEL_DIRECTORY OUTPUT_DIRECTORY`.
`public/action/narration.json` contains the script and timing. The background
music is composed by `src/intro/music.py`; run it with a duration argument of
`40` to reproduce this bed. The model weights are not committed.

The finished promo is published separately at `/promos/gandd-in-action.mp4`;
it is not embedded in the homepage.
