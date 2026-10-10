# G&D social promotion

30 seconds, vertical 1080 × 1920, 30 fps. For law and medicine students,
with calm music and a playful opening. Conversations are illustrative examples.
Music is composed by `music.py`; no third-party soundtrack is used.

From `my-video`, after `npm ci`:

```sh
npx remotion render src/intro/social.tsx GandDSocial /tmp/gd-intro-silent.mp4 --browser-executable=/usr/bin/chromium --crf=22
python3 src/intro/music.py /tmp/gd-intro-music.wav
ffmpeg -i /tmp/gd-intro-silent.mp4 -i /tmp/gd-intro-music.wav -map 0:v:0 -map 1:a:0 -vf scale=in_range=pc:out_range=tv -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -color_range tv -af volume=2 -c:a aac -b:a 128k -shortest -movflags +faststart /tmp/gandd-social-promo.mp4
```

Adjust the browser executable for other machines. All copy is baked into the
video so it remains readable when posted with the sound off. Keep the important
content clear of social app controls at the top and bottom.

The finished export is served at `/promos/gandd-law-medicine.mp4`. It is a
downloadable social promo and does not load in the homepage.
