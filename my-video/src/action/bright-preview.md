# Bright motion direction preview

24-second vertical creative preview, 1080 × 1920 / 30 fps, following the
user's reference: light gradients, rotating page cards, animated type,
player cards and a score reveal. Purpose: review the visual direction before
finishing a full promotional film. Illustrative answer and quiz cards,
sample players and scores; the inset screenshots are from the actual app
with intercepted sample backend data. The preview labels this on screen.

Books and pages are drawn in code. Narration is generated offline using the
same public-domain LJ Speech model documented in README.md. Music is original,
with seeded synthesised transition accents. No reference footage is reused.

Render from my-video:

```sh
npx remotion render src/action/bright-preview.tsx GandDBrightPreview /tmp/gd-bright-silent.mp4 --browser-executable=/usr/bin/chromium --crf=20
python3 src/action/bright-audio.py MODEL_DIRECTORY /tmp/gd-bright-audio
```

The final mux ducks music under the narration and mixes transition effects.
The 24-second preview is shared for discussion; it does not replace the
previous published 40-second video.
